"""Regression tests for cache reuse, freshness, and source failure semantics."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_live', root / 'scripts' / 'fetch_live.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)
try:
    from scripts import source_policy
except ModuleNotFoundError:
    import source_policy


class SourcePolicyTests(TestCase):
    def previous(self, minutes=2):
        at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        stamp = at.isoformat(timespec='seconds').replace('+00:00', 'Z')
        previous = collector.empty_snapshot()
        previous['generated_at'] = stamp
        previous['sources'] = {
            'cbp': {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp},
            'cbsa': {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp},
            'dwt': {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp},
            'cbsa_hours': {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp},
            'ontario511': {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp},
        }
        previous['directions'] = {'us': {'ambassador': {'standard': {'minutes': 5}}},
                                  'ca': {'tunnel': {'standard': {'minutes': 10}}}}
        previous['supplemental']['dwt'] = {'us': {'lane_counts': {'nexus': 1}}}
        previous['supplemental']['cbsa_nexus_hours'] = {'tunnel': {'groups': []}}
        previous['supplemental']['ontario511_events'] = []
        return previous, stamp

    def test_reuse_preserves_original_success_timestamp(self):
        previous, stamp = self.previous()
        next_snapshot = collector.empty_snapshot()
        self.assertTrue(source_policy.reuse_cached_source(
            next_snapshot, previous, 'cbp', 'directions', 'us'))
        self.assertEqual(next_snapshot['sources']['cbp']['retrieved_at'], stamp)
        self.assertEqual(next_snapshot['sources']['cbp']['last_success_at'], stamp)
        self.assertTrue(next_snapshot['sources']['cbp']['cache_reused'])
        self.assertEqual(next_snapshot['directions']['us'], previous['directions']['us'])

    def test_dwt_cache_interval_matches_20_minute_ui_gate(self):
        self.assertEqual(source_policy.MIN_CHECK_INTERVAL_MINUTES['dwt'], 9)
        for minutes, expected in ((2, True), (8, True), (10, False), (19, False), (30, False)):
            with self.subTest(age_minutes=minutes):
                previous, stamp = self.previous(minutes=minutes)
                result = collector.empty_snapshot()
                reused = source_policy.reuse_cached_source(
                    result, previous, 'dwt', 'supplemental', 'dwt')
                self.assertEqual(reused, expected)
                if expected:
                    self.assertEqual(result['sources']['dwt']['retrieved_at'], stamp)
                    self.assertEqual(result['sources']['dwt']['cache_policy_minutes'], 9)
                    self.assertTrue(result['sources']['dwt']['cache_reused'])
                else:
                    self.assertNotIn('dwt', result['sources'])

    def test_valid_empty_alert_list_may_be_cached(self):
        previous, _ = self.previous()
        result = collector.empty_snapshot()
        self.assertTrue(source_policy.reuse_cached_source(
            result, previous, 'ontario511', 'supplemental', 'ontario511_events'))
        self.assertEqual(result['supplemental']['ontario511_events'], [])

    def test_expired_or_failed_source_must_be_fetched(self):
        previous, _ = self.previous(minutes=20)
        self.assertFalse(source_policy.reuse_cached_source(
            collector.empty_snapshot(), previous, 'cbp', 'directions', 'us'))
        previous['sources']['cbp']['status'] = 'error'
        previous['sources']['cbp']['retained_previous'] = True
        self.assertFalse(source_policy.reuse_cached_source(
            collector.empty_snapshot(), previous, 'cbp', 'directions', 'us'))

    def test_collector_uses_prior_primary_data_without_upstream_requests(self):
        previous, stamp = self.previous()
        with patch.dict('os.environ', {'ONTARIO_511_API_KEY': ''}):
            with patch.object(collector, 'get_text', side_effect=AssertionError('unexpected fetch')):
                result = collector.collect(previous=previous)
        for key in ('cbp', 'cbsa', 'dwt', 'cbsa_hours'):
            self.assertEqual(result['sources'][key]['status'], 'ok')
            self.assertTrue(result['sources'][key]['cache_reused'])
            self.assertEqual(result['sources'][key]['last_success_at'], stamp)



    def test_slow_supplemental_failure_retains_historical_report(self):
        previous, _ = self.previous()
        old_success = (datetime.now(timezone.utc) - timedelta(minutes=70)).isoformat(
            timespec='seconds').replace('+00:00', 'Z')
        previous['sources']['ontario511_construction'] = {
            'status': 'ok', 'retrieved_at': old_success, 'last_success_at': old_success
        }
        previous['supplemental']['ontario511_construction'] = [{'id': 'archived-roadwork'}]
        result = collector.empty_snapshot()
        result['sources']['ontario511_construction'] = {'status': 'error'}
        collector.retain_on_failure(result, previous)
        src = result['sources']['ontario511_construction']
        self.assertEqual(src['status'], 'error')
        self.assertTrue(src['retained_previous'])
        self.assertEqual(src['last_success_at'], old_success)
        self.assertEqual(result['supplemental']['ontario511_construction'],
                         [{'id': 'archived-roadwork'}])

    def test_historical_fallback_expires_after_two_collection_cycles(self):
        previous, _ = self.previous()
        old_success = (datetime.now(timezone.utc) - timedelta(minutes=140)).isoformat(
            timespec='seconds').replace('+00:00', 'Z')
        previous['sources']['ontario511_construction'] = {
            'status': 'ok', 'retrieved_at': old_success, 'last_success_at': old_success
        }
        previous['supplemental']['ontario511_construction'] = [{'id': 'archived-roadwork'}]
        result = collector.empty_snapshot()
        result['sources']['ontario511_construction'] = {'status': 'error'}
        collector.retain_on_failure(result, previous)
        self.assertNotIn('retained_previous', result['sources']['ontario511_construction'])
        self.assertEqual(result['supplemental']['ontario511_construction'], [])

    def test_upstream_failure_does_not_renew_observation(self):
        previous, stamp = self.previous(minutes=20)
        with patch.dict('os.environ', {'ONTARIO_511_API_KEY': ''}):
            with patch.object(collector, 'get_text', side_effect=RuntimeError('offline')):
                result = collector.collect(previous=previous)
        self.assertEqual(result['sources']['cbp']['status'], 'error')
        self.assertTrue(result['sources']['cbp']['retained_previous'])
        self.assertEqual(result['sources']['cbp']['last_success_at'], stamp)
        self.assertFalse(result['sources']['cbp'].get('cache_reused', False))
