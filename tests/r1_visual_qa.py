"""Matched before/after screenshots: same synthetic snapshot; no upstream requests."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
import dashboard_mobile_qa as qa

baseline = Path(sys.argv[1]).resolve()
current = qa.ROOT
out = qa.OUT
data = qa.snapshot()

def capture(browser, root, tag, width, theme, payload, large=False):
    qa.ROOT = root
    context = browser.new_context(viewport={"width":width,"height":844},
        is_mobile=True, has_touch=True, device_scale_factor=1, color_scheme=theme)
    page = context.new_page()
    errors=[]
    page.on("pageerror", lambda e: errors.append(str(e)))
    qa.boot(page, payload, large=large)
    assert not errors, errors
    if tag.startswith("after"):
        qa.check_geometry(page, width, large=large)
        if not large:
            board=page.locator(".comparison").bounding_box()
            assert board["y"] + board["height"] <= 844
            assert page.locator(".crossing-name").evaluate_all("""names => names.every(n => {
                const range=document.createRange();range.selectNodeContents(n);
                const box=n.getBoundingClientRect();
                return [...range.getClientRects()].every(r=>r.left>=box.left-1&&r.right<=box.right-3);
            })"""), "Crossing name crosses its column or has no gap"
            assert page.locator(".wait-cell").evaluate_all("""cells => cells.every(c => {
                const b=c.getBoundingClientRect();
                return [...c.querySelectorAll('.pair-amount,.wait-number,.wait-unit')].every(n=>{
                  const r=n.getBoundingClientRect(); return r.left>=b.left-1&&r.right<=b.right+1;
                });
            })"""), "Numeric reading crosses cell bounds"
    page.screenshot(path=str(out / f"r1-{tag}-{width}-{theme}.png"),full_page=True)
    context.close()

with sync_playwright() as p:
    import shutil
    binary=next((x for n in ("chromium","chromium-browser","google-chrome","google-chrome-stable") if (x:=shutil.which(n))),None)
    assert binary
    browser=p.chromium.launch(executable_path=binary, headless=True,args=["--no-sandbox"])
    try:
        for theme in ("light","dark"):
            capture(browser,baseline,"before",390,theme,data)
            for width in (320,360,390,430):
                capture(browser,current,"after",width,theme,data)
        from copy import deepcopy
        two_digit=deepcopy(data)
        two_digit["directions"]["us"]["ambassador"]["nexus"]["minutes"]=99
        two_digit["directions"]["us"]["ambassador"]["standard"]["minutes"]=99
        capture(browser,current,"after-two-digit",320,"light",two_digit)
        mixed=deepcopy(data)
        mixed["directions"]["us"]["ambassador"]["nexus"]["minutes"]=120
        mixed["directions"]["us"]["ambassador"]["standard"]["minutes"]=135
        mixed["directions"]["us"]["tunnel"]["nexus"]["observation_at"]=qa.ago(45)
        mixed["directions"]["us"]["gordie"]["nexus"]["status"]="closed"
        mixed["directions"]["us"]["gordie"]["nexus"]["minutes"]=None
        mixed["supplemental"]["dwt"]["ca"]["lane_counts"]["nexus"]=0
        capture(browser,current,"after-exceptions",320,"light",mixed)
        capture(browser,current,"after-exceptions",320,"dark",mixed)
        capture(browser,current,"after-large",320,"light",data,large=True)
    finally:
        browser.close()
print("R1 matched before/after and exceptional-state screenshots captured.")
