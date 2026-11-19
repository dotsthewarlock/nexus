"""Ontario 511 adapter regression checks; all inputs synthetic, no API calls."""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ontario_511', ROOT / 'scripts' / 'ontario_511.py')
ont = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ont)

spec2 = importlib.util.spec_from_file_location('fetch_live', ROOT / 'scripts' / 'fetch_live.py')
collector = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(collector)


class TestOntario511(unittest.TestCase):
    def test_official_endpoints_and_distinct_types(self):
        self.assertEqual(len(ont.ENDPOINTS), 4)
        self.assertEqual(ont.ENDPOINTS['ontario511_road_conditions'][1],
                         'https://511on.ca/api/v3/get/roadconditions')

    def test_event_filters_by_road_and_location(self):
        base = {'ID': 25, 'RoadwayName': '401', 'Latitude': 42.29,
                'Longitude': -83.04, 'Description': 'Lanes blocked',
                'StartDate': 1760000000, 'PlannedEndDate': 1830000000,
                'LastUpdated': 1760000000, 'IsFullClosure': True}
        near = ont.normalize(json.dumps([base]), 'events')
        self.assertEqual(len(near), 1)
        self.assertTrue(near[0]['is_full_closure'])
        self.assertIsNotNone(near[0]['last_updated'])
        other = dict(base, Latitude=44.0)
        self.assertEqual(ont.normalize(json.dumps([other]), 'events'), [])
        unrelated = dict(base, RoadwayName='Highway 17')
        self.assertEqual(ont.normalize(json.dumps([unrelated]), 'events'), [])

    def test_construction_and_upcoming(self):
        item = {'ID': 9, 'RoadwayName': 'Huron Church Road', 'Latitude': 42.27,
                'Longitude': -83.07, 'EventType': 'roadwork',
                'StartDate': 1795100000, 'PlannedEndDate': 1795300000}
        from datetime import datetime, timezone
        now = datetime.fromtimestamp(1795000000, timezone.utc)
        out = ont.normalize(json.dumps([item]), 'construction', now)
        self.assertEqual(out[0]['timing'], 'upcoming')

    def test_road_condition_and_stale_source_time(self):
        entry = {'RoadwayName': '401', 'LocationDescription': 'Near Windsor',
                 'Condition': ['Snow covered'], 'LastUpdated': 1750000000}
        out = ont.normalize(json.dumps([entry]), 'road_conditions')
        self.assertEqual(out[0]['category'], 'road_condition')
        self.assertTrue(out[0]['is_adverse'])
        self.assertEqual(out[0]['last_updated'], '2025-06-15T15:06:40Z')

    def test_alert_requires_precise_local_road(self):
        good = {'Id': 7, 'Message': 'Windsor Highway 401 closure',
                'StartTime': 1760000000, 'EndTime': 1830000000}
        bad = {'Id': 8, 'Message': 'Southwestern Ontario weather alert'}
        self.assertEqual(len(ont.normalize(json.dumps([good]), 'alerts')), 1)
        self.assertEqual(ont.normalize(json.dumps([bad]), 'alerts'), [])

    def test_reject_invalid_payload(self):
        with self.assertRaises(ValueError):
            ont.normalize('{"not":"an array"}', 'events')

    def test_credential_is_not_published(self):
        with patch.dict(os.environ, {'ONTARIO_511_API_KEY': 'SENSITIVE_TEST_KEY'}, clear=False):
            with patch.object(collector, 'get_text', side_effect=RuntimeError('SENSITIVE_TEST_KEY')):
                with patch.object(collector, 'normalize_cbsa_csv', side_effect=ValueError('bad')):
                    result = collector.collect(cbp_text='broken', cbsa_text='broken',
                                               ontario_events_text='[]')
        self.assertNotIn('SENSITIVE_TEST_KEY', json.dumps(result))
        self.assertEqual(result['sources']['ontario511']['status'], 'ok')
        self.assertEqual(result['sources']['ontario511_construction']['status'], 'not_collected')


if __name__ == '__main__':
    unittest.main()
