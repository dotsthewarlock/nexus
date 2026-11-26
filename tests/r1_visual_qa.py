"""Matched before/after screenshots: same synthetic snapshot; no upstream requests."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
import dashboard_mobile_qa as qa

baseline = Path(sys.argv[1]).resolve()
current = qa.ROOT
out = qa.OUT
data = qa.snapshot()

def audit_accessibility(page, selector):
    """Check actual computed foreground/background and visible targets, not just token pairs."""
    result=page.locator(selector).evaluate("""root => {
        const colors=s=>{const m=s.match(/[\\d.]+/g);return m?m.map(Number):[]};
        const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4})
            .reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
        const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const background=el=>{
            for(let n=el;n;n=n.parentElement){
                const c=colors(getComputedStyle(n).backgroundColor);
                if(c.length>=3&&(c.length===3||c[3]===1))return c;
            }
            return [255,255,255];
        };
        const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'
            &&!el.closest('[hidden],dialog:not([open])');
        const contrast=[],targets=[];let min=Infinity,checked=0;
        for(const el of [root,...root.querySelectorAll('*')]){
            if(!visible(el)||el.matches('option,svg *,script,style'))continue;
            const st=getComputedStyle(el);
            const directText=[...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
            if(directText||el.matches('select')){
                const value=ratio(colors(st.color),background(el));
                checked++;min=Math.min(min,value);
                if(value<4.5-.001)contrast.push({tag:el.tagName,id:el.id,cls:el.className,text:el.textContent.trim().slice(0,50),ratio:value});
            }
            if(el.matches('button,select,a[href],summary')){
                const r=el.getBoundingClientRect();
                if(r.width<47.5||r.height<47.5)targets.push({id:el.id,tag:el.tagName,text:el.textContent.trim().slice(0,50),w:r.width,h:r.height});
            }
        }
        return {contrast,targets,min,checked};
    }""")
    assert not result["contrast"], f"Contrast failures: {result['contrast']}"
    assert not result["targets"], f"Touch target failures: {result['targets']}"
    assert result["checked"]>0
    print(f"Computed text contrast {selector}: minimum {result['min']:.2f}:1; {result['checked']} text elements")

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
    if tag.startswith("after"):
        audit_accessibility(page,".app-shell")
    page.screenshot(path=str(out / f"r1-{tag}-{width}-{theme}.png"),full_page=True)
    if tag=="after" and width==390:
        page.locator('.wait-cell[data-crossing="tunnel"][data-direction="ca"]').click()
        audit_accessibility(page,"#detailDialog")
        page.locator("#detailClose").click()
        page.locator("#settingsOpen").click()
        audit_accessibility(page,"#settingsDialog")
        page.locator("#sortToggle").click()
        audit_accessibility(page,"#sortMenu")
        page.locator("#settingsClose").click()
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
