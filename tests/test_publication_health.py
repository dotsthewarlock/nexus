"""Offline tests for best-effort public Pages verification and collection-gap reporting."""
import json
import os
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import report_health, verify_publication


def snapshot(minutes=5):
    return {
        'schema': 'nexus-live-v2',
        'generated_at': '2026-11-19T21:49:33Z',
        'sources': {'cbp': {'status': 'ok', 'retrieved_at': '2026-11-19T21:49:30Z'},
                    'cbsa': {'status': 'error'}},
        'directions': {'us': {'ambassador': {'standard': {'minutes': minutes}}},
                       'ca': {}},
        'supplemental': {},
    }


class PublicationVerificationTests(unittest.TestCase):
    def test_exact_public_snapshot_and_html_match(self):
        expected = snapshot()
        self.assertTrue(verify_publication.check_snapshot(expected, json.dumps(expected).encode()))
        self.assertTrue(verify_publication.check_html(b'<h1>Nexus</h1>', b'<h1>Nexus</h1>'))

    def test_public_snapshot_must_match_full_data_not_just_generation_time(self):
        expected = snapshot()
        changed = snapshot(minutes=0)
        with self.assertRaisesRegex(ValueError, 'differs'):
            verify_publication.check_snapshot(expected, json.dumps(changed).encode())
        older = snapshot()
        older['generated_at'] = '2026-11-19T21:39:33Z'
        with self.assertRaisesRegex(ValueError, 'generation'):
            verify_publication.check_snapshot(expected, json.dumps(older).encode())

    def test_html_must_match(self):
        with self.assertRaisesRegex(ValueError, 'dashboard HTML'):
            verify_publication.check_html(b'new', b'old')

    def test_rejects_html_error_or_wrong_schema_as_public_json(self):
        with self.assertRaisesRegex(ValueError, 'valid JSON'):
            verify_publication.check_snapshot(snapshot(), b'<html>Not found</html>')
        bad = snapshot()
        bad['schema'] = 'nexus-live-v1'
        with self.assertRaisesRegex(ValueError, 'schema'):
            verify_publication.check_snapshot(snapshot(), json.dumps(bad).encode())

    def test_cache_busting_requires_https_and_preserves_existing_query(self):
        with self.assertRaises(ValueError):
            verify_publication.cache_busted_url('http://example.com/a', '22')
        url = verify_publication.cache_busted_url('https://example.com/a?old=1', '22')
        self.assertEqual(url, 'https://example.com/a?old=1&verify_run=22')

    def test_retry_then_match_without_real_network(self):
        expected = snapshot()
        state = {'requests': 0}
        def fake_fetch(url):
            state['requests'] += 1
            if 'live.json' in url:
                if state['requests'] == 1:
                    return json.dumps(snapshot(minutes=3)).encode()
                return json.dumps(expected).encode()
            return b'<h1>Nexus</h1>'
        sleeps = []
        ok, attempts, msg = verify_publication.verify(
            expected, b'<h1>Nexus</h1>', 'https://example.com/live.json',
            'https://example.com/', 'x123', attempts=3, pause_seconds=0.1,
            fetch=fake_fetch, sleep=sleeps.append)
        self.assertTrue(ok)
        self.assertEqual(attempts, 2)
        self.assertEqual(sleeps, [0.1])
        self.assertIn('Both published files match', msg)

    def test_failed_public_check_is_warning_only_unless_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'live.json'
            page = Path(tmp) / 'index.html'
            source.write_text(json.dumps(snapshot()), encoding='utf-8')
            page.write_bytes(b'Nexus')
            args = ['--snapshot-file', str(source), '--site-file', str(page),
                    '--attempts', '1', '--pause-seconds', '0']
            with patch.object(verify_publication, 'verify',
                              return_value=(False, 1, 'Public fetch failed')):
                self.assertEqual(verify_publication.main(args), 0)
                self.assertEqual(verify_publication.main(args + ['--strict']), 1)


class PublicationGapTests(unittest.TestCase):
    def test_elapsed_between_known_publications(self):
        data = {'generated_at': '2026-11-19T21:49:33Z',
                'collection': {'previous_snapshot_at': '2026-11-19T19:02:46Z',
                               'configured_interval_minutes': 10}}
        self.assertEqual(report_health.publication_gap_minutes(data), 166.8)
        self.assertEqual(report_health.gap_warning_threshold(data), 30)

    def test_missing_previous_is_unknown_not_silent_success(self):
        self.assertIsNone(report_health.publication_gap_minutes({
            'generated_at': '2026-11-19T21:49:33Z', 'collection': {}}))

    def test_future_previous_and_invalid_timestamps_do_not_count(self):
        self.assertIsNone(report_health.publication_gap_minutes({
            'generated_at': '2026-11-19T19:00:00Z',
            'collection': {'previous_snapshot_at': '2026-11-19T21:00:00Z'}}))
        self.assertIsNone(report_health.publication_gap_minutes({
            'generated_at': '2026-11-19T19:00:00Z',
            'collection': {'previous_snapshot_at': 'nonsense'}}))

    def test_provisional_threshold_respects_longer_schedule(self):
        self.assertEqual(report_health.gap_warning_threshold({'collection': {
            'configured_interval_minutes': 15}}), 45)
        self.assertEqual(report_health.gap_warning_threshold({'collection': {
            'configured_interval_minutes': -20}}), 30)



class PagesArtifactVisibilityTests(unittest.TestCase):
    """Exercise the actual workflow shell with simulated API responses."""

    def run_wait(self, outcomes, artifact_id='123'):
        workflow = (Path(__file__).resolve().parents[1] /
                    '.github/workflows/publish.yml').read_text(encoding='utf-8')
        step = workflow.split('      - name: Wait for Pages artifact metadata\n', 1)[1]
        block = step.split('        run: |\n', 1)[1].split('      - name:', 1)[0]
        script = textwrap.dedent(block)
        mock = r"""
timeout() { shift; "$@"; }
gh() {
    IFS=, read -ra responses <<< "$OUTCOMES"
    local result="${responses[$((attempt-1))]:-missing}"
    if [ "$result" = error ]; then return 1; fi
    printf '%s\n' "$result"
}
sleep() { printf 'mock sleep %s\n' "$1"; }
"""
        env = dict(os.environ, OUTCOMES=','.join(outcomes), ARTIFACT_ID=artifact_id,
                   GITHUB_REPOSITORY='example/nexus', RUN_ID='42')
        return subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', mock + script],
                              env=env, capture_output=True, text=True, timeout=5)

    def test_exact_upload_ready(self):
        result = self.run_wait(['123'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('mock sleep 15', result.stdout)
        self.assertNotIn('mock sleep 5', result.stdout)

    def test_retry_missing_wrong_id_and_api_error(self):
        result = self.run_wait(['missing', '456', 'error', '123'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.count('mock sleep 5'), 3)
        self.assertIn('mock sleep 15', result.stdout)

    def test_ambiguity_fails_without_deployment(self):
        result = self.run_wait(['ambiguous'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing ambiguous deployment', result.stdout)
        self.assertNotIn('mock sleep', result.stdout)

    def test_missing_artifact_stops_after_bounded_attempts(self):
        result = self.run_wait(['missing'])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.count('Waiting for Pages artifact'), 12)
        self.assertEqual(result.stdout.count('mock sleep 5'), 11)
        self.assertNotIn('mock sleep 15', result.stdout)

    def test_invalid_upload_id_fails_before_polling(self):
        result = self.run_wait(['123'], artifact_id='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing or invalid Pages upload artifact ID', result.stdout)
        self.assertNotIn('Waiting for Pages artifact', result.stdout)


if __name__ == '__main__':
    unittest.main()
