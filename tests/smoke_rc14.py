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
   html=re.sub(r'<link rel="stylesheet" href="\./styles\.css(?:\?[^"]*)?">','',html)
   html=re.sub(r'<script src="\./(?:decision|app)\.js(?:\?[^"]*)?"(?: defer)?></script>','',html)
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
  # RC1.4.5 DWT: Watch Live gesture loads the embed, and viewing timer starts
  # on that gesture, not when the modal is opened. Provider playback requires QA.
  page.evaluate('''() => {
    const original=window.setTimeout.bind(window);
    window.setTimeout=(cb,delay,...args)=>delay===15000
      ?(window.__cameraLimit=()=>cb(...args),999999)
      :original(cb,delay,...args);
  }''')
  assert page.locator('#heroCameraText').inner_text()=='Cameras'
  page.locator('#heroCamera').click()
  assert page.locator('#cameraDialog').evaluate('(x)=>x.open')
  assert page.locator('#cameraViews button').count()==2
  assert page.locator('#cameraFrame').get_attribute('src') is None, 'No DWT request before Watch Live'
  assert page.locator('#cameraWatch').is_visible(), 'Explicit opt-in video action'
  page.screenshot(path=str(OUT/'rc145-tunnel-watch-live.png'))
  assert page.evaluate('typeof window.__cameraLimit')=='undefined', 'Timer must not start on opening'
  assert page.locator('#cameraZoomControls').is_hidden()
  assert page.locator('#cameraReload').is_hidden()
  page.locator('#cameraWatch').click()
  assert '794566d4' in page.locator('#cameraFrame').get_attribute('src')
  assert page.evaluate('typeof window.__cameraLimit')=='function', 'Timer must start on Watch Live'
  page.locator('#cameraViews button').nth(1).click()
  assert page.locator('#cameraFrame').get_attribute('src') is None, 'Switch unloads prior player'
  assert page.locator('#cameraWatch').is_visible()
  page.locator('#cameraWatch').click()
  assert '5408b5c3' in page.locator('#cameraFrame').get_attribute('src')
  page.evaluate('window.__cameraLimit()')
  assert page.locator('#cameraFrame').get_attribute('src') is None
  assert page.locator('#cameraContinue').is_visible()
  assert 'Viewing interval complete' in page.locator('#cameraFallbackText').inner_text()
  page.locator('#cameraContinue').click()
  assert '5408b5c3' in page.locator('#cameraFrame').get_attribute('src')
  page.locator('#closeCamera').click()
  assert page.locator('#cameraFrame').get_attribute('src') is None
  page.locator('#toUS').click()
  page.locator('#heroCamera').click()
  assert page.locator('#cameraFrame').get_attribute('src') is None
  page.locator('#cameraWatch').click()
  assert '4aea1c45' in page.locator('#cameraFrame').get_attribute('src')
  assert page.locator('#cameraViews').is_hidden()
  page.locator('#closeCamera').click()
  page.locator('#toCA').click()
  page.locator('#alternatives button[data-crossing="ambassador"]').click()
  assert page.locator('#crossingRole').inner_text()=='SELECTED FOR THIS TRIP'
  assert page.locator('#heroCameraText').inner_text()=='Camera'
  page.locator('#heroCamera').click()
  assert 'cam1.html' in page.locator('#cameraFrame').get_attribute('src'), 'Canada-bound bridge camera'
  zoom=page.locator('#cameraZoomSurface')
  zoom_controls=page.locator('#cameraZoomControls')
  assert page.locator('#cameraDialog').evaluate('(x)=>x.classList.contains("camera-modal--bridge")')
  assert zoom.is_visible() and zoom_controls.is_visible()
  assert zoom_controls.locator('button').count()==4
  assert zoom_controls.locator('button[data-scale="4"]').get_attribute('aria-pressed')=='true'
  assert 'scale(4)' in page.locator('#cameraFrame').get_attribute('style'), '4x on open'
  stage=page.locator('#cameraStage').bounding_box()
  vp=page.evaluate('({width:innerWidth,height:innerHeight})')
  dialog=page.locator('#cameraDialog').bounding_box()
  assert stage['height']>=vp['height']*.56, f'Camera stage unexpectedly short: {stage} {vp}'
  assert vp['height']*.88 <= dialog['height'] <= vp['height']*.91, '90vh camera modal'
  assert vp['width']-dialog['width']>=12 and vp['width']-dialog['width']<=18, 'Modal margins'
  assert page.locator('#cameraFrame').evaluate('(el)=>Math.abs(el.offsetHeight/el.offsetWidth - .75)<.03'), '4:3 camera viewport'
  page.wait_for_function("document.querySelector('#cameraFrame').style.transform.includes('scale(4)') && !document.querySelector('#cameraFrame').style.transform.includes('translate(0px, 0px)')")
  frame_style=page.locator('#cameraFrame').get_attribute('style')
  import re as _re
  pan=_re.search(r'translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(4\)',frame_style)
  assert pan, f'Missing expected 4x pan transform: {frame_style}'
  xpan,ypan=map(float,pan.groups())
  max_pan=page.locator('#cameraFrame').evaluate("""(el)=>{
    const stage=document.querySelector('#cameraStage');
    return {x:Math.max(0,(el.offsetWidth*4-stage.clientWidth)/2),
            y:Math.max(0,(el.offsetHeight*4-stage.clientHeight)/2)};
  }""")
  assert max_pan['x']>0 and max_pan['y']>0, 'Zoom permits pans on both axes'
  assert abs(xpan/max_pan['x']-0.20)<.02, f'Left framing pan differs: {xpan}/{max_pan}'
  assert abs(ypan/max_pan['y']-0.50)<.02, f'Upward framing pan differs: {ypan}/{max_pan}'
  page.screenshot(path=str(OUT/'rc145-bridge-default.png'))
  zoom_controls.locator('button[data-scale="1"]').click()
  assert page.locator('#cameraFrame').evaluate('(el)=>getComputedStyle(el).transform')=='none', 'Fit'
  zoom_controls.locator('button[data-scale="2"]').click()
  assert 'scale(2)' in page.locator('#cameraFrame').get_attribute('style')
  zoom_controls.locator('button[data-scale="3"]').click()
  assert 'scale(3)' in page.locator('#cameraFrame').get_attribute('style')
  zoom_controls.locator('button[data-scale="4"]').click()
  assert 'scale(4)' in page.locator('#cameraFrame').get_attribute('style')
  bbox=zoom.bounding_box()
  x,y=bbox['x']+bbox['width']/2,bbox['y']+bbox['height']/2
  before=page.locator('#cameraFrame').get_attribute('style')
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-42,y+24,steps=6);page.mouse.up()
  after=page.locator('#cameraFrame').get_attribute('style')
  assert after!=before, 'Drag pans 4x camera'
  zoom.click(position={'x':75,'y':65})
  assert zoom_controls.locator('button[data-scale="1"]').get_attribute('aria-pressed')=='true', 'Tap fits'
  zoom.focus();zoom.press('Enter')
  assert zoom_controls.locator('button[data-scale="4"]').get_attribute('aria-pressed')=='true', 'Keyboard zooms'
  page.locator('#closeCamera').click()
  assert zoom.is_hidden(), 'Zoom overlay must reset after close'
  page.locator('#heroCamera').click()
  assert zoom_controls.locator('button[data-scale="4"]').get_attribute('aria-pressed')=='true', '4x restores on reopen'
  page.locator('#closeCamera').click()
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
  pg.locator('#alternatives button[data-crossing="ambassador"]').click()
  pg.locator('#heroCamera').click()
  assert pg.locator('#cameraZoomControls').is_visible(), '320px zoom options visible'
  stage320=pg.locator('#cameraStage').bounding_box()
  assert stage320['height']>300 and pg.locator('#cameraDialog').bounding_box()['width']>=303, '320px camera fills most of viewport'
  pg.locator('#cameraZoomControls button[data-scale="1"]').click()
  assert pg.locator('#cameraZoomControls button[data-scale="1"]').get_attribute('aria-pressed')=='true'
  pg.locator('#closeCamera').click()
  narrow.close()
  desktop=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=1)
  d=desktop.new_page();boot(d)
  d.screenshot(path=str(OUT/'rc14-desktop.png'),full_page=True)
  desktop.close()
  assert not errors,errors
  browser.close()
 print('RC1.4.5 camera smoke passed: DWT Watch Live/15s continue; 4x bridge default with 20% left, 50% up; 320/390/1440px.')
if __name__=='__main__': main()
