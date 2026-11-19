"""Unit fixtures for the Nexus schedule-trigger audit (no network requests)."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import audit_schedule as audit

UTC = timezone.utc
NOW = datetime(2026, 11, 19, 22, 0, tzinfo=UTC)
MINUTES = [3, 13, 23, 33, 43, 53]


def run_at(day, hour, minute, event='schedule'):
    return {'event': event, 'created_at':
            datetime(2026, 11, day, hour, minute, tzinfo=UTC).isoformat()}


class CronPolicyTests(unittest.TestCase):
    def test_parse_current_workflow(self):
        path = Path(__file__).parent.parent / '.github/workflows/publish.yml'
        self.assertEqual(audit.cron_minutes(path.read_text(encoding='utf-8')), MINUTES)

    def test_supported_minute_stride(self):
        value = "- cron: '*/10 * * * *'\n"
        self.assertEqual(audit.cron_minutes(value), list(range(0, 60, 10)))

    def test_reject_ambiguous_or_nonhourly_policy(self):
        for text in [
            "- cron: '3,13 * * * *'\n- cron: '6,16 * * * *'\n",
            "- cron: '0 6 * * *'\n",
            "- cron: '* * * * *'\n",
            "- cron: '4,4 * * * *'\n",
            "- cron: '60 * * * *'\n",
        ]:
            with self.assertRaises(ValueError):
                audit.cron_minutes(text)

    def test_utc_minute_slots_across_hour(self):
        start = datetime(2026, 11, 19, 20, 40, tzinfo=UTC)
        end = datetime(2026, 11, 19, 21, 16, tzinfo=UTC)
        self.assertEqual(
            [x.strftime('%H:%M') for x in audit.scheduled_slots(start, end, MINUTES)],
            ['20:43', '20:53', '21:03', '21:13']
        )

    def test_iso_timestamp_requires_timezone(self):
        with self.assertRaises(ValueError):
            audit.timestamp('2026-11-19T22:00:00')
        self.assertEqual(audit.timestamp('2026-11-19T17:00:00-05:00'), NOW)


class EvidenceTests(unittest.TestCase):
    def test_list_workflow_runs_paginates_and_separates_events(self):
        hits = []
        changed = {'commit': {'committer': {'date': '2026-11-19T20:00:00Z'}}}
        hundred = [run_at(19, 20, 3)] * 100
        def fake_fetch(path, token):
            hits.append((path, token))
            if '/commits?' in path:
                return [changed]
            if '&page=1' in path:
                return {'total_count': 101, 'workflow_runs': hundred}
            if '&page=2' in path:
                return {'total_count': 101, 'workflow_runs': [run_at(19, 20, 13)]}
            raise AssertionError('Unexpected REST call')
        modified, runs, complete = audit.load_evidence(
            'dotsthewarlock/nexus', token='test-token', fetch=fake_fetch
        )
        self.assertEqual(modified, datetime(2026, 11, 19, 20, 0, tzinfo=UTC))
        self.assertEqual(len(runs), 101)
        self.assertTrue(complete)
        self.assertEqual(len(hits), 3)
        self.assertTrue(all(t == 'test-token' for _, t in hits))
        self.assertTrue(all('/repos/dotsthewarlock/nexus/' in p for p, _ in hits))

    def test_malicious_repo_path_rejected(self):
        for repo in ['', '../../other', 'name only', 'owner/repo/extra', 'https://example.com']:
            with self.assertRaises(ValueError):
                audit.validate_repo(repo)


class AssessmentTests(unittest.TestCase):
    def test_no_warning_before_workflow_has_stabilized(self):
        changed = datetime(2026, 11, 19, 21, 52, tzinfo=UTC)
        result = audit.assess(NOW, changed, [], MINUTES)
        self.assertEqual(result['expected'], 0)
        self.assertEqual(result['status'], 'warming_up')

    def test_multi_hour_gap_is_reported_independently_of_pushes(self):
        changed = datetime(2026, 11, 19, 20, 0, tzinfo=UTC)
        runs = [run_at(19, 20, 13), run_at(19, 20, 23, 'push')]
        report = audit.assess(NOW, changed, runs, MINUTES)
        self.assertEqual(report['expected'], 10)
        self.assertEqual(report['observed'], 1, 'Push-triggered runs never count')
        self.assertEqual(report['shortfall'], 9)
        self.assertEqual(report['status'], 'gap')
        self.assertIn('possible missed/delayed execution', audit.summary(report))

    def test_healthy_scheduling_is_not_accused_of_gaps(self):
        changed = datetime(2026, 11, 19, 20, 0, tzinfo=UTC)
        expected = audit.scheduled_slots(changed, NOW - timedelta(minutes=20), MINUTES)
        runs = [{'event': 'schedule', 'created_at': d.isoformat()} for d in expected]
        report = audit.assess(NOW, changed, runs, MINUTES)
        self.assertEqual(report['status'], 'tracking')
        self.assertEqual(report['shortfall'], 0)

    def test_incomplete_api_history_must_not_claim_a_schedule_gap(self):
        changed = datetime(2026, 11, 19, 20, 0, tzinfo=UTC)
        report = audit.assess(NOW, changed, [run_at(19, 21, 13)], MINUTES,
                              complete=False)
        self.assertEqual(report['status'], 'incomplete')
        report = audit.assess(NOW, changed, [run_at(19, 19, 50)], MINUTES,
                              complete=False)
        self.assertTrue(report['history_complete_for_window'],
                        'Fetched entries older than baseline cover all needed slots')

    def test_ignore_future_run_and_malformed_run_records(self):
        changed = datetime(2026, 11, 19, 20, 0, tzinfo=UTC)
        report = audit.assess(NOW, changed, [
            run_at(19, 23, 3),
            {'event': 'schedule', 'created_at': 'bad timestamp'},
            run_at(19, 21, 3, event='workflow_dispatch')
        ], MINUTES)
        self.assertEqual(report['observed'], 0)
        self.assertIsNone(report['last_schedule'])


class NonBlockingWorkflowTests(unittest.TestCase):
    def test_api_error_warns_but_never_blocks_publication(self):
        def fail(*args, **kwargs):
            raise OSError('credential=SHOULD-NOT-APPEAR')
        path = Path(__file__).parent.parent / '.github/workflows/publish.yml'
        capture = io.StringIO()
        with patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': ''}):
            with redirect_stdout(capture):
                result = audit.main(['--workflow-file', str(path)], fetch=fail, now=NOW)
        self.assertEqual(result, 0)
        self.assertIn('schedule audit unavailable', capture.getvalue())
        self.assertNotIn('SHOULD-NOT-APPEAR', capture.getvalue())

    def test_workflow_token_must_be_scoped_to_audit_not_site(self):
        workflow = (Path(__file__).parent.parent /
                    '.github/workflows/publish.yml').read_text(encoding='utf-8')
        self.assertIn('actions: read', workflow)
        self.assertIn('python scripts/audit_schedule.py', workflow)
        self.assertIn('GH_TOKEN: ' + '$' + '{{ github.token }}', workflow)
        self.assertNotIn('cp scripts/audit_schedule.py site/', workflow)


if __name__ == '__main__':
    unittest.main()
