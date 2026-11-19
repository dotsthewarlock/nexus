"""Regression tests for provenance-preserving fallback and schedule caching."""
import copy
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from test_fetch import CBP, CBSA_CSV, mod


class TestRc148Integrity(unittest.TestCase):
    def good(self):
        return mod.collect(json.dumps(CBP), CBSA_CSV, 'csv')

    def test_failed_cbp_preserves_historical_not_live(self):
        previous = self.good()
        prior_stamp = previous['sources']['cbp']['last_success_at']
        result = mod.collect('invalid json', CBSA_CSV, 'csv', previous=previous)
        self.assertEqual(result['sources']['cbp']['status'], 'error')
        self.assertTrue(result['sources']['cbp']['retained_previous'])
        self.assertEqual(result['sources']['cbp']['last_success_at'], prior_stamp)
        self.assertEqual(result['directions']['us'], previous['directions']['us'])
        self.assertEqual(result['sources']['cbsa']['status'], 'ok')
        self.assertEqual(result['collection']['previous_snapshot_at'], previous['generated_at'])

    def test_both_border_sources_fail_and_previous_is_missing(self):
        r = mod.collect('invalid', 'invalid', 'csv')
        self.assertEqual(r['sources']['cbp']['status'], 'error')
        self.assertEqual(r['sources']['cbsa']['status'], 'error')
        self.assertEqual(r['directions'], {'us': {}, 'ca': {}})

    def test_invalid_and_expired_previous_rejected(self):
        good = self.good()
        for bad in ({'schema': 'unrecognized'},
                    {**good, 'generated_at': '2100-01-01T00:00:00Z'},
                    {**good, 'generated_at': '2000-01-01T00:00:00Z'}):
            self.assertIsNone(mod.validated_previous(bad))
            r = mod.collect('bad cbp', CBSA_CSV, 'csv', previous=bad)
            self.assertEqual(r['directions']['us'], {})
            self.assertNotIn('retained_previous', r['sources']['cbp'])

    def test_old_source_success_does_not_refresh_on_failure(self):
        old = self.good()
        old['sources']['cbp']['last_success_at'] = (datetime.now(timezone.utc) - timedelta(minutes=121)).isoformat()
        old['sources']['cbp']['retrieved_at'] = old['sources']['cbp']['last_success_at']
        r = mod.collect('bad cbp', CBSA_CSV, 'csv', previous=old)
        self.assertEqual(r['directions']['us'], {})
        self.assertNotIn('retained_previous', r['sources']['cbp'])

    def test_schedule_from_previous_is_reused_without_refetch(self):
        previous=self.good()
        stamp=mod.now_utc()
        previous['sources']['cbsa_hours']={'status':'ok','retrieved_at':stamp,'last_success_at':stamp,'coverage':1}
        previous['supplemental']['cbsa_nexus_hours']={'tunnel':{'groups':[{'label':'Weekdays','rows':[]}]}}
        calls=[]
        def fake_get(url):
            calls.append(url)
            if url == mod.CBP_URL: return json.dumps(CBP)
            if url == mod.CBSA_CSV_URL: return CBSA_CSV
            if url == mod.DWT_URL: return '{"not":"valid"}'
            raise AssertionError('Unexpected upstream request ' + url)
        with patch.object(mod,'get_text',side_effect=fake_get):
            result=mod.collect(previous=previous)
        self.assertNotIn(mod.CBSA_HOURS_URL, calls)
        self.assertTrue(result['sources']['cbsa_hours']['cache_reused'])
        self.assertEqual(result['sources']['cbsa_hours']['retrieved_at'],stamp)
        self.assertEqual(result['supplemental']['cbsa_nexus_hours'],previous['supplemental']['cbsa_nexus_hours'])
        self.assertEqual(result['sources']['dwt']['status'],'error')

    def test_previous_backup_never_changes_lane_measurement_time(self):
        good=self.good()
        reported=good['directions']['us']['tunnel']['standard']['observation_at']
        failed=mod.collect('broken', CBSA_CSV, 'csv', previous=good)
        self.assertEqual(failed['directions']['us']['tunnel']['standard']['observation_at'],reported)
        self.assertNotEqual(failed['sources']['cbp']['retrieved_at'],None)
        self.assertTrue(failed['sources']['cbp']['retained_previous'])


if __name__ == '__main__':
    unittest.main()
