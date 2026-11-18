"""Browser smoke test for RC1.3. CSS injected as text because browser sandbox blocks localhost.
All wait and camera traffic is synthetic. Does not make live requests.
"""
from pathlib import Path
from datetime import datetime, timezone
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'index.html').read_text()
CSS=(ROOT/'styles.css').read_text()
NOW=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')

def lane(n, count):
    return {'minutes':n,'status':'reported','observation_at':NOW,'lanes_open':count}

DATA={
  'schema':'nexus-live-v1','generated_at':NOW,
  'sources':{'cbp':{'status':'ok','retrieved_at':NOW,'coverage':3},'cbsa':{'status':'ok','retrieved_at':NOW,'coverage':3}},
  'directions':{
    'us':{c:{'standard':lane(w,4),'nexus':lane(n,1),'port_status':'Open','notice':None}
          for c,w,n in [('ambassador',15,3),('tunnel',5,4),('gordie',0,2)]},
    'ca':{c:{'standard':lane(w,0),'nexus':None,'port_status':None,'notice':None}
          for c,w in [('ambassador',15),('tunnel',5),('gordie',0)]}
  }
}

errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    def init_page(page,geo=False):
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.goto('about:blank')
        page.evaluate('''({payload,geolocation})=>{
          window.fetch=async()=>({ok:true,json:async()=>payload});
          if(geolocation){
            Object.defineProperty(navigator,'permissions',{configurable:true,value:{query:async()=>({state:'granted'})}});
            Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition: cb=>cb({coords:{latitude:42.35,longitude:-83.1}})}});
          }
        }''', {'payload':DATA,'geolocation':geo})
        page.set_content(HTML,wait_until='load')
        page.add_style_tag(content=CSS)
        page.wait_for_function("document.querySelector('#demoHeading').textContent.includes('official')")
    mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
    init_page(mobile)
    assert mobile.locator('link[href="./styles.css"]').count()==1
    assert mobile.evaluate("getComputedStyle(document.body).backgroundColor")=='rgb(243, 246, 249)'
    assert mobile.locator('.crossing-card').count()==3
    assert mobile.locator('.wait-block').count()==6
    assert mobile.locator('.camera-btn').count()==3
    mobile.locator('#settingsButton').click()
    assert mobile.locator('#nexusInput').is_checked()
    mobile.locator('#closeSettings').click()
    assert 'NEXUS' in mobile.locator('#sortNote').inner_text()
    for card in mobile.locator('.crossing-card').all():
        assert 'REGULAR' in card.inner_text().upper() and 'NEXUS' in card.inner_text().upper()
        assert 'lanes reported open' in card.inner_text()
    mobile.locator('article.crossing-card').filter(has=mobile.get_by_role('heading',name='Ambassador Bridge')).locator('.camera-btn').click()
    assert mobile.locator('#cameraDialog').evaluate('(e) => e.open')
    assert mobile.locator('#cameraOfficial').get_attribute('href')=='https://www.ambassadorbridge.com/into-the-united-states/'
    assert mobile.locator('#cameraTry').is_visible()
    mobile.screenshot(path=str(ROOT/'rc13-camera-modal-preview.png'),full_page=True)
    mobile.locator('#cameraTry').click()
    assert mobile.locator('#cameraFrame').get_attribute('src')=='https://ambassador.solutionspal.com/cams/cam2.html'
    mobile.locator('#closeCamera').click()
    assert not mobile.locator('#cameraDialog').evaluate('(e) => e.open')
    assert mobile.locator('#cameraFrame').get_attribute('src') is None
    mobile.screenshot(path=str(ROOT/'rc13-mobile-preview.png'),full_page=True)
    mobile.locator('#toCA').click()
    assert 'CBSA official' in mobile.locator('#demoHeading').inner_text()
    assert 'Canada-bound NEXUS hours' in mobile.locator('.crossing-card').first.inner_text()
    mobile.locator('article.crossing-card').filter(has=mobile.get_by_role('heading',name='Ambassador Bridge')).locator('.camera-btn').click()
    assert mobile.locator('#cameraOfficial').get_attribute('href')=='https://www.ambassadorbridge.com/into-canada/'
    mobile.locator('#closeCamera').click()
    mobile.locator('article.crossing-card').filter(has=mobile.get_by_role('heading',name='Gordie Howe International Bridge')).locator('.camera-btn').click()
    assert 'mdotjboss' in mobile.locator('#cameraOfficial').get_attribute('href')
    assert not mobile.locator('#cameraTry').is_visible()
    mobile.locator('#closeCamera').click()
    mobile.locator('#settingsButton').click()
    mobile.locator('#themeInput').select_option('dark')
    mobile.locator('#saveSettings').click()
    assert mobile.evaluate("getComputedStyle(document.body).backgroundColor")=='rgb(14, 25, 36)'
    mobile.screenshot(path=str(ROOT/'rc13-mobile-dark-preview.png'),full_page=True)
    desktop=browser.new_page(viewport={'width':1240,'height':840})
    init_page(desktop,geo=True)
    desktop.wait_for_function("document.querySelector('#locationStatus').textContent.includes('In USA')")
    assert desktop.locator('#toCA').get_attribute('aria-pressed')=='true'
    desktop.screenshot(path=str(ROOT/'rc13-desktop-preview.png'),full_page=True)
    assert not errors,errors
    print('PASS: mobile, desktop, external CSS, light/dark, camera modal, iframe on-demand, CBSA fallback, NEXUS default, Detroit -> Canada geolocation')
    browser.close()
