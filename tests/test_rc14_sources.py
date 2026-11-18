import importlib.util
import json
from pathlib import Path
import unittest
from datetime import datetime, timezone

spec=importlib.util.spec_from_file_location('fetch_live',Path(__file__).resolve().parents[1]/'scripts'/'fetch_live.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
DWT='''[{"CarLaneCount":2,"NexusLaneCount":2,"TruckLaneCount":0,"Direction":"Detroit To Windsor","DetailsDate":"11/18/2026 11:15:50 AM","DetailsTravelTime":"< 20","UpdateUser":"private"},{"CarLaneCount":4,"NexusLaneCount":1,"TruckLaneCount":1,"Direction":"Windsor To Detroit","DetailsDate":"11/18/2026 11:16:02 AM","DetailsTravelTime":"< 20"}]'''
class TestRC14(unittest.TestCase):
 def test_dwt_directional_values_and_no_user(self):
  d=mod.normalize_dwt(DWT)
  self.assertEqual(d['ca']['lane_counts']['nexus'],2)
  self.assertEqual(d['us']['lane_counts']['car'],4)
  self.assertEqual(d['ca']['observation_at'],'2026-11-18T16:15:50Z')
  self.assertNotIn('private',json.dumps(d))
 def test_dwt_invalid_timestamp_not_renewed(self):
  d=mod.normalize_dwt('[{"Direction":"Windsor To Detroit","DetailsDate":"invalid","NexusLaneCount":2}]')
  self.assertIsNone(d['us']['observation_at'])
 def test_cbp_expanded_fields(self):
  text='''[{"port_name":"Detroit","crossing_name":"Windsor Tunnel","date":"11/18/2026","time":"12:31:15","port_status":"Open","hours":"24 hrs/day","passenger_vehicle_lanes":{"maximum_lanes":"5","standard_lanes":{"operational_status":"no delay","delay_minutes":"5","lanes_open":"2","update_time":"At Noon EST"},"NEXUS_SENTRI_lanes":{"operational_status":"no delay","delay_minutes":"0","lanes_open":"1","update_time":"At Noon EST"},"ready_lanes":{"operational_status":"N/A"}},"commercial_vehicle_lanes":{"maximum_lanes":"4","standard_lanes":{"operational_status":"delay","delay_minutes":"40","lanes_open":"2","update_time":"At Noon EST"},"FAST_lanes":{"operational_status":"Lanes Closed"}}}]'''
  r=mod.normalize_cbp(text)['tunnel'];self.assertEqual(r['passenger_max_lanes'],5)
  self.assertEqual(r['commercial']['minutes'],40)
  self.assertEqual(r['fast']['status'],'closed')
  self.assertEqual(r['ready']['status'],'not_applicable')
  self.assertEqual(r['nexus']['minutes'],0)
 def test_cbsa_commercial(self):
  csv='''Windsor-Detroit Tunnel,35 minutes,No Delay,2026-11-18 12:15 EST'''
  r=mod.normalize_cbsa_csv(csv)['tunnel']
  self.assertEqual(r['commercial']['minutes'],35)
  self.assertEqual(r['standard']['minutes'],0)
 def test_ontario_road_area_filter(self):
  now=datetime(2026,11,18,tzinfo=timezone.utc)
  events=[{'ID':1,'Latitude':42.23,'Longitude':-83.06,'RoadwayName':'HWY 401','Description':'Lane closure','StartDate':0,'PlannedEndDate':1899999999,'IsFullClosure':True},
          {'ID':2,'Latitude':43.65,'Longitude':-79.6,'RoadwayName':'HWY 401','Description':'Toronto'},
          {'ID':3,'Latitude':42.26,'Longitude':-83.03,'RoadwayName':'Residential Road','Description':'Irrelevant'},
          {'ID':4,'Latitude':42.23,'Longitude':-83.06,'RoadwayName':'HWY 401','StartDate':0,'PlannedEndDate':1699999999}]
  r=mod.normalize_ontario_events(json.dumps(events),now)
  self.assertEqual(len(r),1);self.assertTrue(r[0]['is_full_closure'])
 def test_official_nexus_schedule_extraction(self):
  office={'offices':[{'name':'Ambassador Bridge','hours':[{'labelEn':'Travellers','officeHours':[{'labelEn':'7 days per week','customEn':'24h'}]},{'labelEn':'Dedicated NEXUS lanes towards Canada','officeHours':[{'labelEn':'Lane One Weekends and Holidays','start':'08:00','end':'22:00','inputType':'time'},{'labelEn':'Lane One Weekdays (except holidays)','start':'07:00','end':'00:00','inputType':'time'}]}]},{'name':'Windsor-Detroit Tunnel','hours':[{'labelEn':'Dedicated NEXUS lanes towards Canada','officeHours':[{'labelEn':'Weekdays','start':'07:00','end':'22:00'}]}]},{'name':'Random Office','hours':[]}]}
  d=mod.normalize_cbsa_nexus_hours(json.dumps(office))
  self.assertEqual(set(d),{'ambassador','tunnel'})
  self.assertEqual(d['ambassador']['groups'][0]['rows'][0]['start'],'08:00')
  self.assertIn('NEXUS',d['ambassador']['groups'][0]['label'])
 def test_schema_and_supplemental_without_network(self):
  r=mod.empty_snapshot();self.assertEqual(r['schema'],'nexus-live-v2');self.assertEqual(r['supplemental']['dwt'],{})
if __name__=='__main__':unittest.main()
