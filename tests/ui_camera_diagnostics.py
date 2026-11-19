"""Local-only Chromium functional test. External player responses are mocked; no playback claim."""
from pathlib import Path
from playwright.sync_api import sync_playwright

PAGE = Path(__file__).resolve().parents[1] / 'camera-diagnostics.html'
SOURCES = (
    '4aea1c45-d402-3690-afae-fe635942da82',
    '794566d4-a75e-3cd1-6f95-2d60e54f2fdb',
    '5408b5c3-f8d1-f34b-a18a-9943047905b6',
)


def main():
    for width in (320, 390, 1440):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': width, 'height': 780})
            requests = []
            def mock_stream(route):
                requests.append(route.request.url)
                route.fulfill(status=200, content_type='text/html', body='<html><body>Mock Dacast response for UI testing</body></html>')
            context.route('https://iframe.dacast.com/**', mock_stream)
            page = context.new_page()
            errors=[]
            page.on('pageerror', lambda err: errors.append(str(err)))
            page.set_content(PAGE.read_text(encoding='utf-8'), wait_until='domcontentloaded')
            assert len(requests) == 0, f'Unexpected automatic stream load at {width}px'
            assert page.locator('#operatorStage iframe').count() == 0
            assert page.locator('#nexusFrame').get_attribute('src') is None
            assert page.locator('#reportFallback').is_hidden()
            assert page.locator('#cameraView option').count() == 3
            assert page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth+2'), f'Horizontal overflow at {width}px'
            page.locator('#testOperator').click()
            assert page.locator('#emptyState').is_hidden()
            frame = page.locator('#operatorStage iframe')
            assert frame.count() == 1
            assert frame.get_attribute('src').endswith(SOURCES[0])
            assert frame.get_attribute('allow') == 'encrypted-media'
            assert page.locator('#nexusFrame').get_attribute('src') is None
            page.locator('#testNexus').click()
            assert page.locator('#operatorStage iframe').count() == 0
            assert page.locator('#nexusFrame').get_attribute('src').endswith(SOURCES[0])
            assert 'autoplay' in page.locator('#nexusFrame').get_attribute('allow')
            page.locator('#cameraView').select_option(SOURCES[1])
            assert page.locator('#nexusFrame').get_attribute('src') is None
            assert page.locator('#directPlayer').get_attribute('href').endswith(SOURCES[1])
            page.locator('#testOperator').click()
            assert page.locator('#operatorStage iframe').get_attribute('src').endswith(SOURCES[1])
            page.locator('#stopTest').click()
            assert page.locator('#emptyState').is_visible()
            assert page.locator('#operatorStage iframe').count() == 0
            page.locator('#resultA').select_option('blocked')
            page.locator('#resultB').select_option('playable')
            page.locator('#notes').fill('Test note: sample error')
            # Safe stub of clipboard, no real browser permissions or external transfer.
            page.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.testCopied=text}}})')
            page.locator('#copyReport').click()
            page.wait_for_function('window.testCopied && window.testCopied.includes("Test note: sample error")')
            copied = page.evaluate('window.testCopied')
            assert 'A: "Content blocked on this website"' in copied
            assert 'B: Video plays (after Play if needed)' in copied
            # Clipboard-denied path must expose the full manual-copy report.
            page.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async()=>{throw Error("not allowed")}}})')
            page.locator('#copyReport').click()
            assert page.locator('#reportFallback').is_visible()
            assert 'Test note: sample error' in page.locator('#reportFallback').input_value()
            page.locator('#resetResults').click()
            assert page.locator('#reportFallback').is_hidden()
            assert page.locator('#resultA').input_value() == 'not_tested'
            assert page.locator('#notes').input_value() == ''
            assert not errors, errors
            print(f'DWT diagnostic UI passed at {width}px; mocked player requests: {len(requests)}')
            context.close()
            browser.close()


if __name__ == '__main__':
    main()
