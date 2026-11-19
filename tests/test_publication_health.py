"""Offline tests for best-effort public Pages verification and collection-gap reporting."""
import json
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


if __name__ == '__main__':
    unittest.main()
