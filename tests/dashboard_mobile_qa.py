#!/usr/bin/env python3
"""Primary Nexus dashboard browser QA (synthetic data only; no live upstream).

Use Chromium/Chrome on the CI runner. These assertions check DOM geometry and
semantics at common mobile widths, dark mode, enlarged text and keyboard flows.
Screenshots are evidence for visual review, not a substitute for device/AT QA.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "qa-artifacts"
OUT.mkdir(exist_ok=True)


def ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def snapshot():
    def lane(minutes, count=None, minutes_old=2):
        return {"status": "reported", "minutes": minutes,
                "lanes_open": count, "observation_at": ago(minutes_old)}

    def us(regular, nexus):
        return {"standard": lane(regular, 3), "nexus": lane(nexus, 1),
                "ready": {"status": "not_applicable", "minutes": None},
                "commercial": lane(9, 1), "fast": {"status": "not_applicable", "minutes": None},
                "port_status": "Open"}

    def ca(regular):
        return {"standard": lane(regular), "commercial": lane(8),
                "nexus": None, "port_status": "Open"}

    return {
        "schema": "nexus-live-v2", "generated_at": ago(1),
        "sources": {
            "cbp": {"status": "ok", "retrieved_at": ago(1)},
            "cbsa": {"status": "ok", "retrieved_at": ago(1)},
            "dwt": {"status": "ok", "retrieved_at": ago(1)},
        },
        "directions": {
            "ca": {"ambassador": ca(8), "tunnel": ca(6), "gordie": ca(4)},
            "us": {"ambassador": us(5, 2), "tunnel": us(0, 7), "gordie": us(10, 3)},
        },
        "supplemental": {
            "dwt": {"ca": {"source": "DWT", "observation_at": ago(2),
                           "lane_counts": {"nexus": 2, "car": 2}}}
        },
    }


def boot(page, data, large=False):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'<link[^>]+href="\./dashboard\.css[^"]*"[^>]*>', "", html)
    html = re.sub(r'<script src="\./(?:decision|dashboard)\.js[^"]*"[^>]*></script>', "", html)
    page.route("**/*", lambda route: route.abort())
    page.set_content(html, wait_until="domcontentloaded")
    page.add_style_tag(content=(ROOT / "dashboard.css").read_text(encoding="utf-8"))
    if large:
        # Tests 200% root-font scaling/reflow. Actual OS zoom and assistive
        # technology remain separate manual release checks.
        page.add_style_tag(content="html{font-size:32px!important}")
    page.evaluate("""data => {
        window.fetch = async () => ({ok:true, json:async()=>data});
    }""", data)
    page.add_script_tag(content=(ROOT / "decision.js").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "dashboard.js").read_text(encoding="utf-8"))
    page.wait_for_function("document.querySelectorAll('#crossingRows .crossing-row').length === 3")
    page.wait_for_function("!document.querySelector('#summary').textContent.includes('Checking')")


def rect(page, selector):
    result = page.locator(selector).first.bounding_box()
    assert result is not None, f"Missing visible element: {selector}"
    return result


def check_geometry(page, width, large=False):
    assert page.evaluate("window.innerWidth") == width
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), (
        f"Unexpected horizontal overflow at {width}px, large={large}")
    assert page.locator(".crossing-row").count() == 3
    assert page.locator(".crossing-row .wait-cell").count() == 6
    assert page.locator(".table-header [role=columnheader]").count() == 3
    assert page.locator(".crossing-row [role=rowheader]").count() == 3
    assert page.locator(".crossing-row [role=cell]").count() == 6
    assert page.locator(".crossing-row").first.locator(".wait-cell").count() == 2
    for selector in ("#vehicleSelect", "#laneSelect",
                     ".wait-cell[data-crossing=tunnel][data-direction=ca]"):
        box = rect(page, selector)
        assert box["height"] >= 43.5, f"Touch target too small: {selector}, {box}"
        assert box["x"] >= -1 and box["x"] + box["width"] <= width + 1, (
            f"Target extends beyond viewport: {selector}, {box}")
    if large:
        assert page.locator("html").get_attribute("data-large-text") == "true"
        rowheader = rect(page, ".crossing-row:first-child .crossing-name")
        cell = rect(page, ".crossing-row:first-child .wait-wrap")
        assert rowheader["y"] < cell["y"], "Large text should stack crossing name above direction cells"
    else:
        assert page.locator("html").get_attribute("data-large-text") == "false"
        rowheader = rect(page, ".crossing-row:first-child .crossing-name")
        cell = rect(page, ".crossing-row:first-child .wait-wrap")
        assert abs(rowheader["y"] - cell["y"]) < 2, "Normal mode must keep a compact three-column row"
        a, b = (rect(page, x)["y"] for x in
                   ("#vehicleSelect", "#laneSelect"))
        assert max(a, b) - min(a, b) < 3, "Exactly one normal quick-controls row"



def test_interactions(page):
    # G1: first launch is Passenger + NEXUS, with CBSA general on Canada side.
    ca = page.locator('.wait-cell[data-crossing="tunnel"][data-direction="ca"]')
    us = page.locator('.wait-cell[data-crossing="tunnel"][data-direction="us"]')
    assert page.locator("#vehicleSelect").input_value() == "passenger"
    assert page.locator("#laneSelect").input_value() == "nexus"
    assert "6 min" in ca.inner_text(), "CBSA general passenger reading remains visible once"
    assert "2 lanes" in ca.inner_text() and "DWT" in ca.inner_text(), (
        "Current DWT supplemental count is independent of the CBSA general wait")
    assert us.locator(".pair-amount").all_inner_texts() == ["7", "0"], (
        "USA must pair CBP NEXUS 7 with CBP Regular verified zero")
    assert us.locator(".pair-separator").inner_text().strip() == "/"
    separator_padding = us.locator(".pair-separator").evaluate(
        "(el)=>parseFloat(getComputedStyle(el).paddingLeft)")
    assert separator_padding >= 3, "Slash requires visible spacing; 7/0 is ambiguous"
    assert "min" in us.locator(".wait-unit").inner_text()
    assert "1 / 3 lanes" in us.inner_text(), "Each CBP lane count keeps its category"
    assert page.locator("#pairLegend").is_visible()
    assert "NEXUS first / Regular second" in page.locator("#pairLegend").inner_text()
    spoken = us.get_attribute("aria-label") or ""
    assert "NEXUS 7 minutes" in spoken and "Regular 0 minutes" in spoken
    assert "CBP observed" in spoken
    sizes = us.locator(".pair-amount").evaluate_all(
        "(els)=>els.map(el=>getComputedStyle(el).fontSize)")
    assert len(sizes) == 2 and len(set(sizes)) == 1, (
        "NEXUS and Regular digits must have identical font size")

    # G2: details identify independently sourced categories and Canada general reading.
    ca.focus()
    ca.press("Enter")
    assert page.locator("#detailDialog").evaluate("(el)=>el.open")
    assert page.locator("#detailTitle").inner_text() == "Detroit–Windsor Tunnel"
    assert page.locator("#detailTitle").evaluate("(el)=>document.activeElement===el")
    assert page.locator("#detailCa").get_attribute("aria-pressed") == "true"
    assert "CBSA general passenger" in page.locator("#detailCategory").inner_text()
    assert "2 NEXUS lanes open" in page.locator("#detailDwtReport").inner_text()
    page.locator("#detailUs").click()
    assert page.locator("#detailUs").get_attribute("aria-pressed") == "true"
    assert page.locator("#detailDwt").is_hidden()
    assert page.locator("#detailWait").inner_text() == "7 / 0 min"
    source_text = page.locator("#detailProvenance").inner_text()
    assert "NEXUS" in source_text and "Regular" in source_text
    assert "Physical additivity is unverified" in source_text
    page.keyboard.press("Escape")
    assert not page.locator("#detailDialog").evaluate("(el)=>el.open")

    # G1: Regular is strict when chosen, and removes the paired legend.
    page.locator("#laneSelect").select_option("regular")
    assert "0 min" in us.inner_text() and "/" not in us.inner_text()
    assert page.locator("#pairLegend").is_hidden()

    # G3: sort is available only in Settings, moves entire crossing rows,
    # and retains clear country direction labels.
    assert page.locator("#sortToggle").is_hidden()
    page.locator("#settingsOpen").click()
    assert page.locator("#settingsDialog").evaluate("(el)=>el.open")
    assert page.locator("#settingsTitle").evaluate("(el)=>document.activeElement===el")
    assert rect(page, "#settingsClose")["height"] >= 43.5
    page.locator("#sortToggle").click()
    page.locator('#sortMenu [data-sort="us"]').click()
    assert "Lowest USA wait" in page.locator("#sortToggle").inner_text()
    assert page.locator("#usHeading").inner_text().endswith("↓")
    assert "To Canada" in page.locator("#caHeading").inner_text()
    page.locator("#settingsClose").click()
    assert page.locator(".crossing-row .crossing-name").all_inner_texts() == [
        "Tunnel", "Ambassador", "Gordie Howe"]

    # Theme control stays directly before Settings and switches without resetting sort.
    before = page.locator("body").evaluate("(el)=>getComputedStyle(el).backgroundColor")
    page.locator("#themeToggle").click()
    assert page.locator("html").get_attribute("data-theme") == "dark"
    assert page.locator("#themeToggle").get_attribute("aria-label") == "Switch to light mode"
    after = page.locator("body").evaluate("(el)=>getComputedStyle(el).backgroundColor")
    assert before != after


def test_long_pair(page):
    # G2/G5: three-digit values must reflow instead of reducing numeric font sizes.
    assert page.locator("#laneSelect").input_value() == "nexus"
    us = page.locator('.wait-cell[data-crossing="ambassador"][data-direction="us"]')
    assert us.locator(".pair-stacked-row").count() == 2
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert us.bounding_box()["width"] >= 44
    assert "NEXUS" in us.inner_text() and "Regular" in us.inner_text()


def main():
    binary = next((p for name in
                   ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable")
                   if (p := shutil.which(name))), None)
    assert binary, "Chromium/Chrome executable unavailable on browser QA runner"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=binary, headless=True, args=["--no-sandbox"])
        try:
            for width in (320, 360, 390, 430):
                errors = []
                context = browser.new_context(
                    viewport={"width": width, "height": 844},
                    is_mobile=True, has_touch=True, device_scale_factor=1,
                    color_scheme="light")
                page = context.new_page()
                page.on("pageerror", lambda err: errors.append(str(err)))
                boot(page, snapshot())
                check_geometry(page, width)
                page.screenshot(path=str(OUT / f"dashboard-{width}-light.png"), full_page=True)
                if width == 390:
                    test_interactions(page)
                    page.screenshot(path=str(OUT / "dashboard-390-dark.png"), full_page=True)
                assert not errors, f"Browser JS errors at {width}px: {errors}"
                context.close()

            stress = snapshot()
            stress["directions"]["us"]["ambassador"]["nexus"]["minutes"] = 120
            stress["directions"]["us"]["ambassador"]["standard"]["minutes"] = 135
            context = browser.new_context(
                viewport={"width": 320, "height": 844},
                is_mobile=True, has_touch=True, device_scale_factor=1)
            page = context.new_page()
            boot(page, stress)
            check_geometry(page, 320)
            test_long_pair(page)
            page.screenshot(path=str(OUT / "dashboard-320-long-pair.png"), full_page=True)
            context.close()

            for width in (320, 390, 430):
                context = browser.new_context(
                    viewport={"width": width, "height": 844},
                    is_mobile=True, has_touch=True, device_scale_factor=1)
                page = context.new_page()
                boot(page, snapshot(), large=True)
                check_geometry(page, width, large=True)
                page.screenshot(
                    path=str(OUT / f"dashboard-{width}-large-text.png"), full_page=True)
                context.close()
        finally:
            browser.close()
    print("Primary mobile QA passed: 320/360/390/430px, 200% root text, DOM geometry, "
          "directional detail, touch targets, sorting, dark mode and keyboard Escape.")


if __name__ == "__main__":
    main()
