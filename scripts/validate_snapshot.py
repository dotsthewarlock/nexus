#!/usr/bin/env python3
"""Reject structurally broken snapshots before a GitHub Pages deployment.

Upstream failures are allowed: the collector must be able to publish explicit
unavailable/error states and retained historical records.
"""
from datetime import datetime, timedelta, timezone
import json
import sys


def check(path):
    with open(path, encoding='utf-8') as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or data.get('schema') != 'nexus-live-v2':
        raise ValueError('Unexpected snapshot schema')
    try:
        generated = datetime.fromisoformat(data['generated_at'].replace('Z', '+00:00'))
        if generated.tzinfo is None:
            raise ValueError('Snapshot timestamp has no timezone')
        if generated > datetime.now(timezone.utc) + timedelta(minutes=2):
            raise ValueError('Snapshot timestamp lies in the future')
    except (KeyError, AttributeError, TypeError) as exc:
        raise ValueError('Invalid snapshot generated_at') from exc
    if not isinstance(data.get('sources'), dict):
        raise ValueError('Missing sources object')
    if not isinstance(data.get('directions'), dict):
        raise ValueError('Missing directions object')
    for key, direction in [('cbp', 'us'), ('cbsa', 'ca')]:
        src = data['sources'].get(key)
        if not isinstance(src, dict) or src.get('status') not in ('ok', 'error'):
            raise ValueError(f'Missing primary source status: {key}')
        records = data['directions'].get(direction)
        if not isinstance(records, dict):
            raise ValueError(f'Invalid direction records: {direction}')
        if src['status'] == 'ok' and not records:
            raise ValueError(f'Unusable successful primary response: {key}')
    if not isinstance(data.get('supplemental'), dict):
        raise ValueError('Missing supplemental data')
    # In addition to collector-side sanitation, reject accidental credential
    # URLs in the published document.
    if any('key=' in json.dumps(source).lower() for source in data['sources'].values()):
        raise ValueError('Credential-bearing source URL detected')
    return data


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else 'data/live.json'
    check(path)
    print(f'Validated Nexus snapshot: {path}')
