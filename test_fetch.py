import importlib.util
from pathlib import Path
import json
from datetime import datetime, timezone
import unittest

FILE = Path(__file__).resolve().parents[1] / 'scripts' / 'fetch_live.py'
spec = importlib.util.spec_from_file_location('fetch_live', FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

CBP = [
    {'port_number':'380001', 'port_name':'Detroit', 'crossing_name':'Ambassador Bridge', 'date':'11/18/2026',
     'time':'12:31:15', 'port_status':'Open', 'construction_notice':'Ready Lane starts later',
     'passenger_vehicle_lanes': {'standard_lanes':{'update_time':'At Noon EST','operational_status':'no delay','delay_minutes':'5','lanes_open':'3'},
                                 'NEXUS_SENTRI_lanes':{'update_time':'At Noon EST','operational_status':'no delay','delay_minutes':'0','lanes_open':'1'}}},
    {'port_number':'380002', 'port_name':'Detroit', 'crossing_name':'Windsor Tunnel', 'date':'11/18/2026',
     'time':'12:31:15', 'port_status':'Open',
     'passenger_vehicle_lanes': {'standard_lanes':{'update_time':'At 11:00 am EST','operational_status':'delay','delay_minutes':'15','lanes_open':'3'},
                                 'NEXUS_SENTRI_lanes':{'update_time':'','operational_status':'Lanes Closed','delay_minutes':'','lanes_open':''}}},
    {'port_number':'380102', 'port_name':'Detroit', 'crossing_name':'Gordie Howe International Bridge ', 'date':'11/18/2026',
     'time':'12:31:15', 'port_status':'Open',
     'passenger_vehicle_lanes': {'standard_lanes':{'update_time':'At Noon EST','operational_status':'no delay','delay_minutes':'0','lanes_open':'4'},
                                 'NEXUS_SENTRI_lanes':{'update_time':'At Noon EST','operational_status':'no delay','delay_minutes':'5','lanes_open':'1'}}},
]

CBSA_HTML = '''<html><body><table><thead><tr><th>Port of entry</th><th>Commercial flow</th><th>Travellers flow</th><th>Updated</th></tr></thead>
<tbody><tr><th><a>Windsor-Detroit Tunnel</a><br><span>Windsor, ON/Detroit, MI</span></th><td>Not Applicable</td><td>No Delay</td><td>2026-11-18 12:15 EST</td></tr>
<tr><th>Ambassador Bridge <span>Windsor, ON/Detroit, MI</span></th><td>40 minutes</td><td>10 minutes</td><td>2026-11-18 12:18 EST</td></tr>
<tr><th>Gordie Howe International Bridge</th><td>5 minutes</td><td>No Delay</td><td>2026-11-18 11:57 EST</td></tr></tbody></table></body></html>'''
CBSA_CSV = '''Port of entry,Commercial flow,Travellers flow,Updated\nWindsor-Detroit Tunnel,Not Applicable,No Delay,2026-11-18 12:15 EST\nAmbassador Bridge,40 minutes,10 minutes,2026-11-18 12:18 EST\nGordie Howe International Bridge,5 minutes,No Delay,2026-11-18 11:57 EST\n'''

class TestData(unittest.TestCase):
    def test_cbp_all_three(self):
        data = mod.normalize_cbp(json.dumps(CBP))
        self.assertEqual(set(data), {'ambassador','tunnel','gordie'})
        self.assertEqual(data['ambassador']['standard']['minutes'], 5)
        self.assertEqual(data['ambassador']['nexus']['minutes'], 0)
        self.assertEqual(data['tunnel']['nexus']['status'], 'closed')
        self.assertIsNone(data['tunnel']['nexus']['minutes'])
        self.assertEqual(data['gordie']['standard']['minutes'], 0)
        self.assertEqual(data['ambassador']['standard']['observation_at'], '2026-11-18T17:00:00Z')
        self.assertEqual(data['tunnel']['standard']['observation_at'], '2026-11-18T16:00:00Z')
    def test_cbsa_html(self):
        data = mod.normalize_cbsa_html(CBSA_HTML)
        self.assertEqual(set(data), {'ambassador','tunnel','gordie'})
        self.assertEqual(data['ambassador']['standard']['minutes'], 10)
        self.assertEqual(data['tunnel']['standard']['minutes'], 0)
        self.assertIsNone(data['tunnel']['nexus'])
        self.assertEqual(data['gordie']['standard']['observation_at'], '2026-11-18T16:57:00Z')
    def test_cbsa_csv(self):
        data = mod.normalize_cbsa_csv(CBSA_CSV)
        self.assertEqual(len(data), 3)
        self.assertEqual(data['ambassador']['standard']['minutes'], 10)
    def test_missing_not_zero(self):
        x = mod.parse_wait('Not Applicable')
        self.assertEqual(x, {'status':'unavailable','minutes':None})
        self.assertIsNone(mod.normalize_lane({'operational_status':'Update Pending', 'delay_minutes':'0'}, CBP[0])['minutes'])
    def test_cbp_previous_day(self):
        x = dict(CBP[0]); x['passenger_vehicle_lanes']={}
        self.assertEqual(mod.parse_cbp_observation(x, {'update_time':'At 11:00 pm EST'}), '2026-11-18T04:00:00Z')
    def test_snapshot_one_source_failure(self):
        result = mod.collect('malformed!', CBSA_HTML, 'html')
        self.assertEqual(result['sources']['cbp']['status'], 'error')
        self.assertEqual(result['sources']['cbsa']['status'], 'ok')
        self.assertEqual(len(result['directions']['ca']), 3)
        self.assertEqual(result['directions']['us'], {})

if __name__ == '__main__': unittest.main()
