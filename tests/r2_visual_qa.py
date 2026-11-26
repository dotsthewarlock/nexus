"""R2 isolated browser persistence, favorite and matched R1/R2 screenshot checks."""
import sys
from pathlib import Path
import shutil
from copy import deepcopy
from playwright.sync_api import sync_playwright
import dashboard_mobile_qa as qa

baseline=Path(sys.argv[1]).resolve()
root=qa.ROOT
out=qa.OUT
data=qa.snapshot()

def boot(page,base,payload,large=False,blocked=False):
    # Actual same-origin storage across reloads, with synthetic data only.
    def route(r):
        url=r.request.url
        if not url.startswith("https://nexus-fixture.test/"):
            return r.abort()
        name=url.split("?",1)[0].split("/")[-1] or "index.html"
        if name=="live.json":return r.fulfill(json=payload)
        if name not in ("index.html","dashboard.js","decision.js","dashboard.css"):
            return r.abort()
        return r.fulfill(path=str(base/name))
    page.route("**/*",route)
    if blocked:
        page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError')}})")
    if large:
        page.add_init_script("document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize='32px';window.dispatchEvent(new Event('resize'))})")
    page.goto("https://nexus-fixture.test/")
    page.wait_for_function("document.querySelectorAll('.wait-cell').length===6 && document.querySelector('#summary').textContent.includes('checked')")
def rows(page):
    return page.locator(".crossing-row").evaluate_all("els=>els.map(e=>e.querySelector('[data-crossing]').dataset.crossing)")
def sort(page,key):
    page.locator("#settingsOpen").click()
    page.locator("#sortToggle").click()
    page.locator(f'[data-sort="{key}"]').click()
    page.locator("#settingsClose").click()
def favorite(page,id):
    page.locator(f'.wait-cell[data-crossing="{id}"][data-direction="ca"]').click()
    page.locator("#favoriteToggle").click()
    page.locator("#detailClose").click()

with sync_playwright() as pw:
    binary=next((p for n in ("chromium","chromium-browser","google-chrome","google-chrome-stable") if (p:=shutil.which(n))),None)
    assert binary
    browser=pw.chromium.launch(executable_path=binary,headless=True,args=["--no-sandbox"])
    for theme in ("light","dark"):
        for width in (320,360,390,430):
            for name,base in (("before",baseline),("after",root)):
                context=browser.new_context(viewport={"width":width,"height":844},is_mobile=True,has_touch=True,color_scheme=theme,device_scale_factor=1)
                page=context.new_page()
                errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
                boot(page,base,data)
                qa.check_geometry(page,width)
                page.screenshot(path=str(out/f"r2-{name}-{width}-{theme}.png"),full_page=True)
                if name=="after":
                    favorite(page,"gordie")
                    assert rows(page)==["gordie","ambassador","tunnel"]
                    assert page.locator(".favorite-marker").count()==1
                    assert page.locator(".crossing-name").first.get_attribute("aria-label").endswith(", favorite")
                    page.screenshot(path=str(out/f"r2-favorite-{width}-{theme}.png"),full_page=True)
                    sort(page,"us");assert rows(page)==["ambassador","gordie","tunnel"]
                    page.locator("#vehicleSelect").select_option("commercial")
                    assert page.locator("#laneSelect").input_value()=="regular"
                    page.locator("#laneSelect").select_option("fast")
                    page.locator("#themeToggle").click()
                    page.reload();page.wait_for_function("document.querySelectorAll('.wait-cell').length===6 && document.querySelector('#summary').textContent.includes('checked')")
                    assert page.locator("#vehicleSelect").input_value()=="commercial"
                    assert page.locator("#laneSelect").input_value()=="fast"
                    assert page.locator("#sortStatus").is_visible()
                    assert rows(page)==["ambassador","tunnel","gordie"],"favorite must not pin during paused numeric sort"
                    assert page.locator(".favorite-marker").count()==1
                    assert page.locator("html").get_attribute("data-theme")==("dark" if theme=="light" else "light")
                    page.screenshot(path=str(out/f"r2-paused-{width}-{theme}.png"),full_page=True)
                    sort(page,"fixed");assert rows(page)==["gordie","ambassador","tunnel"]
                    favorite(page,"gordie");assert rows(page)==["ambassador","tunnel","gordie"]
                    assert page.locator(".favorite-marker").count()==0
                    assert not errors,errors
                context.close()
    for large,blocked in ((True,False),(False,True)):
        context=browser.new_context(viewport={"width":320,"height":844},is_mobile=True,has_touch=True,device_scale_factor=1)
        page=context.new_page();errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        boot(page,root,data,large=large,blocked=blocked)
        if large:page.wait_for_function("document.documentElement.dataset.largeText==='true'")
        qa.check_geometry(page,320,large)
        favorite(page,"tunnel");assert rows(page)[0]=="tunnel"
        page.screenshot(path=str(out/f"r2-{'large' if large else 'blocked'}-320.png"),full_page=True)
        assert not errors,errors
        context.close()
    context=browser.new_context(viewport={"width":320,"height":844},is_mobile=True,has_touch=True)
    page=context.new_page()
    page.add_init_script("localStorage.setItem('nexus-vehicle','commercial');localStorage.setItem('nexus-lane','nexus');localStorage.setItem('unrelated','preserve')")
    boot(page,root,data);assert page.locator("#laneSelect").input_value()=="regular"
    assert "adjusted to Regular" in page.locator("#preferenceStatus").inner_text()
    assert page.evaluate("localStorage.getItem('unrelated')")=="preserve"
    context.close()
    browser.close()
print("R2 persistence, favorite fixed/numeric/paused sort, blocked storage, invalid combination and matched screenshots passed.")
