#!/usr/bin/env python3
"""Best-effort post-deploy check that GitHub Pages serves the just-staged files.

Only public, uncredentialed site URLs are requested. A CDN propagation delay
warns rather than making an otherwise successful Pages deployment fail.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

MAX_RESPONSE_BYTES = 1_500_000
DASHBOARD_ASSETS = ('dashboard.css', 'dashboard.js', 'decision.js',
                    'classic-board.html', 'board.css', 'board.js')


def cache_busted_url(url, run_id):
    """The unique, public run identifier avoids an older CDN/browser cache."""
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.netloc:
        raise ValueError('Publication verification requires an HTTPS URL')
    qs = parse_qsl(parts.query, keep_blank_values=True)
    qs.append(('verify_run', str(run_id)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(qs), parts.fragment))


def fetch_bytes(url, timeout=8):
    request = Request(url, headers={
        'User-Agent': 'Nexus-Publication-Verification/1.0',
        'Accept': 'application/json,text/html;q=0.9,*/*;q=0.2',
        'Cache-Control': 'no-cache',
    })
    with urlopen(request, timeout=timeout) as response:
        payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            raise ValueError('Public response exceeded safety limit')
        return payload


def check_snapshot(expected, served):
    """Compare the full sanitized contract, not only the snapshot timestamp."""
    try:
        actual = json.loads(served.decode('utf-8-sig'))
    except (UnicodeError, ValueError) as exc:
        raise ValueError('Published response is not valid JSON') from exc
    if not isinstance(actual, dict) or actual.get('schema') != 'nexus-live-v2':
        raise ValueError('Published snapshot schema is missing or incorrect')
    if actual.get('generated_at') != expected.get('generated_at'):
        raise ValueError('Published snapshot has a different generation time')
    if actual != expected:
        raise ValueError('Published snapshot differs from the staged data')
    return True


def check_html(expected, served):
    if served != expected:
        raise ValueError('Published dashboard HTML differs from staged HTML')
    return True


def verify(expected_snapshot, expected_html, snapshot_url, html_url, run_id,
           attempts=5, pause_seconds=5, fetch=fetch_bytes, sleep=time.sleep,
           assets=()):
    if attempts < 1:
        raise ValueError('At least one verification attempt is required')
    snapshot_target = cache_busted_url(snapshot_url, run_id)
    html_target = cache_busted_url(html_url, run_id)
    asset_targets = []
    for name, expected in assets:
        if name not in DASHBOARD_ASSETS:
            raise ValueError('Unsupported dashboard asset')
        asset_targets.append((name, expected, cache_busted_url(urljoin(html_url, name), run_id)))
    last_reason = 'Unconfirmed'
    for attempt in range(1, attempts + 1):
        try:
            check_snapshot(expected_snapshot, fetch(snapshot_target))
            check_html(expected_html, fetch(html_target))
            for name, expected, target in asset_targets:
                if fetch(target) != expected:
                    raise ValueError(f'Published {name} differs from staged asset')
            reason = ('Both published files and all requested dashboard assets match the staged build'
                      if asset_targets else 'Both published files match the staged build')
            return True, attempt, reason
        except (OSError, ValueError, TimeoutError) as exc:
            # Do not print raw exception text, which might include URLs or data.
            last_reason = 'Public fetch failed' if isinstance(exc, OSError) else str(exc)
        if attempt < attempts:
            sleep(pause_seconds)
    return False, attempts, last_reason


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot-file', default='data/live.json')
    parser.add_argument('--site-file', default='index.html')
    parser.add_argument('--asset-root', type=Path,
                        help='Verify main and Classic dashboard assets from this staged directory')
    parser.add_argument('--snapshot-url', default='https://dotsthewarlock.github.io/nexus/data/live.json')
    parser.add_argument('--site-url', default='https://dotsthewarlock.github.io/nexus/')
    parser.add_argument('--run-id', default=os.environ.get('GITHUB_RUN_ID', 'manual'))
    parser.add_argument('--attempts', type=int, default=5)
    parser.add_argument('--pause-seconds', type=float, default=5)
    parser.add_argument('--strict', action='store_true',
                        help='Return a failure code if the public files do not match')
    args = parser.parse_args(argv)
    expected_json = json.loads(Path(args.snapshot_file).read_text(encoding='utf-8'))
    expected_html = Path(args.site_file).read_bytes()
    assets = [(name, (args.asset_root / name).read_bytes()) for name in DASHBOARD_ASSETS] if args.asset_root else []
    ok, count, reason = verify(expected_json, expected_html,
                               args.snapshot_url, args.site_url, args.run_id,
                               attempts=args.attempts, pause_seconds=args.pause_seconds, assets=assets)
    report = ('### Public GitHub Pages publication check\n\n'
              + ('MATCH' if ok else 'NOT CONFIRMED')
              + f' after {count} attempt(s). {reason}.\n\n'
              + ('Checks the sanitized JSON, dashboard HTML and main/Classic assets against ' if assets
                 else 'Checks both the sanitized JSON contract and dashboard HTML against ')
              + 'the files staged in this same run. A check cannot establish '
              + 'freshness of the underlying agency observations.\n')
    print(report)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as output:
            output.write('\n' + report)
    if not ok:
        print('::warning title=Nexus publication not verified::'
              'GitHub Pages may be delayed or unavailable; see step summary')
    return 0 if ok or not args.strict else 1


if __name__ == '__main__':
    sys.exit(main())
