#!/usr/bin/env python3
"""One-shot read-only CORS probe for optional browser-direct border feed beta.

Checks how the official endpoints respond to an Origin header matching Nexus.
This is not a substitute for a real browser fetch or verification of usage
permissions. It does not publish, store, or log upstream response bodies.
"""
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import os

ORIGIN = 'https://dotsthewarlock.github.io'
FEEDS = {
    'CBP': 'https://bwt.cbp.gov/api/waittimes',
    'CBSA': 'https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv',
}


def cors_permitted(allow_origin, origin=ORIGIN):
    return allow_origin in (origin, '*')


def inspect(name, url):
    req = Request(url, headers={
        'Origin': ORIGIN,
        'Accept': 'application/json,text/csv,*/*',
        'User-Agent': 'NexusCommuter-BetaCompatibilityProbe/1.0',
    })
    try:
        with urlopen(req, timeout=12) as response:
            allow = response.headers.get('Access-Control-Allow-Origin')
            status = response.status
            final_url = response.url
            return {
                'name': name,
                'status': status,
                'cors': 'header-allows-origin' if cors_permitted(allow) else 'no-compatible-header',
                'allow_origin': allow or '(missing)',
                'redirected': final_url != url,
                'content_type': response.headers.get('Content-Type', '(missing)').split(';')[0],
            }
    except HTTPError as exc:
        return {'name': name, 'status': exc.code, 'cors': 'http-error', 'allow_origin': '(unknown)'}
    except (URLError, TimeoutError, OSError) as exc:
        return {'name': name, 'status': 'unavailable',
                'cors': 'request-failed', 'error_type': type(exc).__name__}


def main():
    results = [inspect(name, url) for name, url in FEEDS.items()]
    lines = ['## Browser-direct compatibility probe', '',
             'Server-originated GET requests with the Nexus Origin header. '
             'A compatible header suggests CORS support but a real browser test '
             'and usage-permission review remain necessary.', '',
             '| Source | HTTP | CORS header | Allow-Origin | Redirect | Content type |',
             '|---|---|---|---|---|---|']
    for r in results:
        lines.append(f"| {r['name']} | {r['status']} | {r['cors']} | "
                     f"{r.get('allow_origin', '(unknown)')} | "
                     f"{r.get('redirected', '?')} | {r.get('content_type', '?')} |")
    output='\n'.join(lines)+'\n'
    print(output)
    if os.getenv('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as fh:
            fh.write(output)


if __name__ == '__main__':
    main()
