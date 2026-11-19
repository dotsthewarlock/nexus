#!/usr/bin/env python3
"""RC1.4.6 browser checks; data are synthetic and no external service is contacted."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
import json,os,re
from playwright.sync_api import sync_playwright
from smoke_rc14 import sample,ROOT

def boot(page,payload):
  html=(ROOT/'index.html').read_text()
  html=re.sub(r'<link rel="stylesheet" href="\./styles\.css(?:\?[^\"]*)?">','',html)
  html=re.sub(r'<script src="\./(?:decision|app)\.js(?:\?[^\"]*)?"(?: defer)?></script>','',html)
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=(ROOT/'styles.css').read_text())
  page.evaluate('''(payload)=>{
    window.__fetchCount=0;
    window.fetch=()=>{window.__fetchCount++;return Promise.resolve({ok:true,json:()=>Promise.resolve(payload)});};
  }''',payload)
  page.add_script_tag(content=(ROOT/'decision.js').read_text())
  page.add_script_tag(content=(ROOT/'app.js').read_text())
  page.wait_for_function('window.__fetchCount>=1 && !document.querySelector("#dataStatus").innerText.includes("Checking published")')

def main():
  os.chdir(ROOT)
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
    page=ctx.new_page()
    boot(page,sample())
    assert '3/3 recent' in page.locator('#dataStatus').inner_text(),page.locator('#dataStatus').inner_text()
    before=page.evaluate('window.__fetchCount')
    page.locator('#refreshButton').click()
    page.wait_for_function('(prev)=>window.__fetchCount===prev+1',arg=before)
    assert 'Latest published snapshot checked' in page.locator('#dataStatus').inner_text()
    page.locator('#refreshButton').click()
    assert page.evaluate('window.__fetchCount')==before+1,'manual cooldown must prevent extra request'
    assert 'Next check in' in page.locator('#dataStatus').inner_text()
    assert page.locator('#refreshButton').get_attribute('aria-label')=='Check latest published border data'
    ctx.close()

    stale=sample()
    stale['directions']['us']['tunnel']['nexus']['observation_at']=(datetime.now(timezone.utc)-timedelta(minutes=35)).isoformat()
    ctx=browser.new_context(viewport={'width':390,'height':844})
    page=ctx.new_page();boot(page,stale)
    assert 'NEXUS conditions unverified' in page.locator('#findingHeading').inner_text()
    assert '5' in page.locator('#primaryValue').inner_text(),'stale numeric value retained'
    assert 'STALE' in page.locator('#primaryNote').inner_text(),page.locator('#primaryNote').inner_text()
    assert page.locator('#primaryValue').evaluate('(el)=>el.closest(".metric").dataset.state')=='stale'
    assert page.locator('#heroFreshness').inner_text().startswith('CBP · NEXUS · Stale'), 'freshness must match visible NEXUS reading, not regular fallback'
    ctx.close()

    expired=sample()
    stamp=(datetime.now(timezone.utc)-timedelta(minutes=68)).isoformat()
    for port in expired['directions']['us'].values():
      port['standard']['observation_at']=stamp
      port['nexus']['observation_at']=stamp
    ctx=browser.new_context(viewport={'width':390,'height':844})
    page=ctx.new_page();boot(page,expired)
    assert 'Current conditions unavailable' in page.locator('#findingHeading').inner_text()
    assert page.locator('#primaryValue').inner_text()=='5',page.locator('#primaryValue').inner_text()
    assert '0/3 recent' in page.locator('#dataStatus').inner_text()
    assert page.locator('#primaryValue').inner_text()=='5', '68-minute report shown as old, not made current'
    assert 'OLD REPORT' in page.locator('#primaryNote').inner_text()
    ctx.close()

    expired=sample()
    stamp=(datetime.now(timezone.utc)-timedelta(minutes=125)).isoformat()
    for port in expired['directions']['us'].values():
      port['standard']['observation_at']=stamp
      port['nexus']['observation_at']=stamp
    ctx=browser.new_context(viewport={'width':390,'height':844})
    page=ctx.new_page();boot(page,expired)
    assert page.locator('#primaryValue').inner_text()=='—', '125-min old readings hidden from headline'
    assert 'Unavailable' in page.locator('#heroFreshness').inner_text()
    assert 'last reported' in page.locator('#detailsBody').text_content().lower()
    ctx.close()

    recovered=sample()
    recovered['sources']['cbp'].update(status='error',retained_previous=True,last_success_at=(datetime.now(timezone.utc)-timedelta(minutes=40)).isoformat())
    ctx=browser.new_context(viewport={'width':390,'height':844})
    page=ctx.new_page();boot(page,recovered)
    assert 'fetch failed' in page.locator('#dataStatus').inner_text()
    assert 'OLD REPORT' in page.locator('#primaryNote').inner_text()
    assert 'Unable' not in page.locator('#primaryNote').inner_text()
    ctx.close()
    browser.close()
  print('RC1.4.8 UI trust checks passed: cooldown, OLD reports, recovery, older history, conservative recommendations.')
if __name__=='__main__': main()
