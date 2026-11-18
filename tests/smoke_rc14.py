#!/usr/bin/env python3
"""Local Chromium smoke test; injected data are synthetic and never shipped."""
from __future__ import annotations
from datetime import datetime,timedelta,timezone
import json
import os
from pathlib import Path
import threading
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'previews'
OUT.mkdir(exist_ok=True)

def sample():
 now=datetime.now(timezone.utc)
 stamp=(now-timedelta(minutes=8)).isoformat()
 dwt_stamp=(now-timedelta(minutes=11)).isoformat()
 def lane(minutes, count):return {'minutes':minutes,'status':'reported','observation_at':stamp,'lanes_open':count}
 def cbp(s,n):return {'source':'CBP','standard':lane(s,3),'nexus':lane(n,1),'ready':{'status':'not_applicable'},'commercial':lane(15,2),'fast':{'status':'closed'},'port_status':'Open','notice':None}
 def cbsa(s):return {'source':'CBSA','standard':lane(s,None),'commercial':lane(5,None),'nexus':None}
 return {'schema':'nexus-live-v2','generated_at':now.isoformat(),
         'sources':{'cbp':{'status':'ok','coverage':3,'retrieved_at':now.isoformat(),'url':'https://bwt.cbp.gov/api/waittimes'},'cbsa':{'status':'ok','coverage':3,'retrieved_at':now.isoformat(),'url':'https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html'},'dwt':{'status':'ok','coverage':2,'retrieved_at':now.isoformat(),'url':'https://api.dwtunnel.com/api/traffic/conditionspublic'},'ontario511':{'status':'not_configured','url':'https://511on.ca/api/v2/get/event'}},
         'directions':{'us':{'tunnel':cbp(15,5),'ambassador':cbp(21,9),'gordie':cbp(12,7)},'ca':{'tunnel':cbsa(4),'ambassador':cbsa(8),'gordie':cbsa(6)}},
         'supplemental':{'dwt':{'us':{'source':'DWT','observation_at':dwt_stamp,'lane_counts':{'car':3,'nexus':1,'truck':0},'travel_time_category':'< 20'},'ca':{'source':'DWT','observation_at':dwt_stamp,'lane_counts':{'car':2,'nexus':2,'truck':0},'travel_time_category':'< 20'}},'ontario511_events':[]}}

def main():
 os.chdir(ROOT)
 url='https://nexus.local/'
 errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
  page=ctx.new_page()
  page.on('pageerror',lambda e:errors.append(str(e)))
  fixture=sample()
  def boot(page):
   html=(ROOT/'index.html').read_text()
   html=html.replace('<link rel="stylesheet" href="./styles.css">','')
   html=re.sub(r'<script src="\./(?:decision|app)\.js"(?: defer)?></script>','',html)
   page.set_content(html,wait_until='domcontentloaded')
   page.add_style_tag(content=(ROOT/'styles.css').read_text())
   page.evaluate('(payload)=>{window.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve(payload)});}',fixture)
   page.add_script_tag(content=(ROOT/'decision.js').read_text())
   page.add_script_tag(content=(ROOT/'app.js').read_text())
   page.wait_for_function("document.querySelector('#primaryValue').textContent === '5'")
  boot(page)
  assert page.locator('#findingHeading').inner_text()=='No significant disruptions reported'
  assert page.locator('#alternatives button').count()==2
  assert page.locator('#heroName').inner_text()=='Detroit–Windsor Tunnel'
  page.screenshot(path=str(OUT/'rc14-mobile-light.png'),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
  page.locator('#settingsButton').click()
  page.locator('#preferredCa').select_option('tunnel')
  page.locator('#themeInput').select_option('dark')
  page.locator('#settingsForm button[type="submit"]').click()
  page.locator('#toCA').click()
  assert page.locator('#heroName').inner_text()=='Detroit–Windsor Tunnel'
  assert 'NEXUS · not reported' in page.locator('#regularLabel').inner_text()
  assert '4' in page.locator('#primaryValue').inner_text()
  assert '2 NEXUS lanes listed' in page.locator('#operatorLine').inner_text()
  page.screenshot(path=str(OUT/'rc14-mobile-dark.png'),full_page=True)
  # Dacast blocks video from github.io. Both Tunnel directions must instead
  # reach the operator's authorized player in one tap, without a broken modal.
  page.evaluate('() => {window.__cameraOpens=[]; window.open=(...args)=>window.__cameraOpens.push(args);}')
  assert page.locator('#heroCameraText').inner_text()=='Cameras ↗'
  page.locator('#heroCamera').click()
  assert page.evaluate('window.__cameraOpens.length')==1
  assert page.evaluate('window.__cameraOpens[0]')==['https://www.dwtunnel.com/','_blank','noopener,noreferrer']
  assert not page.locator('#cameraDialog').evaluate('(x)=>x.open')
  assert page.locator('#cameraFrame').get_attribute('src') is None
  page.locator('#toUS').click()
  page.locator('#heroCamera').click()
  assert page.evaluate('window.__cameraOpens.length')==2
  assert page.evaluate('window.__cameraOpens[1][0]')=='https://www.dwtunnel.com/'
  page.locator('#toCA').click()
  page.locator('#alternatives button[data-crossing="ambassador"]').click()
  assert page.locator('#crossingRole').inner_text()=='SELECTED FOR THIS TRIP'
  assert page.locator('#heroCameraText').inner_text()=='Camera'
  page.locator('#heroCamera').click()
  assert 'cam1.html' in page.locator('#cameraFrame').get_attribute('src'), 'Canada-bound bridge camera'
  zoom=page.locator('#cameraZoomSurface')
  assert zoom.is_visible() and zoom.get_attribute('aria-pressed')=='false'
  zoom.click(position={'x':75,'y':65})
  assert zoom.get_attribute('aria-pressed')=='true'
  assert 'scale(2)' in page.locator('#cameraFrame').get_attribute('style')
  bbox=zoom.bounding_box()
  x,y=bbox['x']+bbox['width']/2,bbox['y']+bbox['height']/2
  before=page.locator('#cameraFrame').get_attribute('style')
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-42,y+24,steps=6);page.mouse.up()
  after=page.locator('#cameraFrame').get_attribute('style')
  assert after!=before, 'Drag should pan zoomed camera'
  zoom.click()
  assert zoom.get_attribute('aria-pressed')=='false' and page.locator('#cameraFrame').evaluate('(el)=>getComputedStyle(el).transform')=='none', 'Tap resets zoom'
  zoom.focus();zoom.press('Enter')
  assert zoom.get_attribute('aria-pressed')=='true', 'Keyboard zoom'
  page.locator('#closeCamera').click()
  assert zoom.is_hidden(), 'Zoom overlay must reset after close'
  page.locator('#resetTrip').click()
  assert page.locator('#heroName').inner_text()=='Detroit–Windsor Tunnel'
  page.locator('#navigateButton').click()
  assert page.locator('#routeDialog').evaluate('(x)=>x.open')
  page.locator('#closeRoute').click()
  ctx.close()
  narrow=browser.new_context(viewport={'width':320,'height':700},device_scale_factor=1)
  pg=narrow.new_page();boot(pg)
  assert pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),'320px horizontal overflow'
  pg.screenshot(path=str(OUT/'rc14-mobile-320.png'),full_page=True)
  narrow.close()
  desktop=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1)
  d=desktop.new_page();boot(d)
  d.screenshot(path=str(OUT/'rc14-desktop.png'),full_page=True)
  desktop.close()
  assert not errors,errors
  browser.close()
 print('RC1.4.2 camera smoke passed: bridge zoom/pan, Tunnel one-tap operator link both directions, 320/390/1440px.')
if __name__=='__main__': main()
