#!/usr/bin/env python3
"""Nexus RC1: normalize public CBP and CBSA observations into static JSON.

Uses the Python standard library. Run on GitHub Actions; no secrets or paid APIs.
A failed source never turns into a zero-minute reading.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

UTC = timezone.utc
EASTERN = ZoneInfo('America/Toronto')
CBP_URL = 'https://bwt.cbp.gov/api/waittimes'
CBSA_CSV_URL = 'https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv'
CBSA_HTML_URL = 'https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html'
CROSSING_NAMES = {
    'ambassador': ('ambassador bridge',),
    'tunnel': ('windsor detroit tunnel', 'detroit windsor tunnel', 'windsor tunnel'),
    'gordie': ('gordie howe international bridge',),
}
PORT_NAMES = {'ambassador': 'Ambassador Bridge', 'tunnel': 'Windsor Tunnel', 'gordie': 'Gordie Howe International Bridge'}


def now_utc():
    return datetime.now(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def iso(dt):
    return dt.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z') if dt else None


def get_text(url):
    req = Request(url, headers={
        'User-Agent': 'NexusCommuter-RC1/0.1 (public border wait feeds; no user identifiers)',
        'Accept': 'application/json,text/csv,text/html,*/*',
    })
    with urlopen(req, timeout=22) as response:
        blob = response.read(3_000_001)
        if len(blob) > 3_000_000:
            raise ValueError('Feed exceeds maximum size')
        return blob.decode('utf-8-sig', 'replace')


def canonical(s):
    return re.sub(r'[^a-z0-9]+', ' ', str(s).casefold()).strip()


def port_id(name):
    slug = canonical(name)
    for key, aliases in CROSSING_NAMES.items():
        if any(alias in slug for alias in aliases):
            return key
    return None


def parse_datetime(raw):
    """CBSA timestamps: YYYY-MM-DD HH:mm EST/EDT (and other zones)."""
    raw = re.sub(r'\s+', ' ', str(raw).strip())
    match = re.search(r'(20\d\d[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2})(?::\d{2})?\s*([A-Za-z]{2,4})?', raw)
    if not match:
        return None
    stamp, clock, zone = match.groups()
    try:
        parsed = datetime.strptime(stamp.replace('/', '-') + ' ' + clock, '%Y-%m-%d %H:%M')
    except ValueError:
        return None
    # Use the published timezone abbreviation, not a UTC-offset inferred from today's DST.
    hours = {'EST': -5, 'EDT': -4, 'CST': -6, 'CDT': -5, 'MST': -7, 'MDT': -6, 'PST': -8, 'PDT': -7, 'AST': -4, 'ADT': -3}
    if zone and zone.upper() in hours:
        return parsed.replace(tzinfo=timezone(timedelta(hours=hours[zone.upper()])))
    if not zone:
        return parsed.replace(tzinfo=EASTERN)
    return None


def parse_cbp_observation(record, lane):
    raw = str(lane.get('update_time', '')).strip()
    if not raw or not record.get('date'):
        return None
    matched = re.search(r'At\s+(Noon|Midnight|\d{1,2}(?::\d{2})?\s*[ap]m)\s*(E[DS]T)?', raw, re.IGNORECASE)
    if not matched:
        return None
    clock, abbr = matched.groups()
    clock = clock.lower().replace(' ', '')
    if clock == 'noon':
        hh, mm = 12, 0
    elif clock == 'midnight':
        hh, mm = 0, 0
    else:
        tm = re.fullmatch(r'(\d{1,2})(?::(\d{2}))?(am|pm)', clock)
        if not tm:
            return None
        hh, mm = int(tm.group(1)) % 12 + (12 if tm.group(3) == 'pm' else 0), int(tm.group(2) or 0)
    try:
        month, day, year = (int(s) for s in record['date'].split('/'))
        zone = timezone(timedelta(hours=-4 if abbr and abbr.upper() == 'EDT' else -5)) if abbr else EASTERN
        dt = datetime(year, month, day, hh, mm, tzinfo=zone)
        # Port record's date may be current day even when last lane update is yesterday.
        timeparts = str(record.get('time', '')).split(':')
        if len(timeparts) >= 2:
            port_dt = datetime(year, month, day, int(timeparts[0]), int(timeparts[1]), tzinfo=zone)
            if dt > port_dt + timedelta(minutes=10):
                dt -= timedelta(days=1)
        return iso(dt)
    except (ValueError, TypeError):
        return None


def normalize_lane(lane, port):
    lane = lane or {}
    raw_status = str(lane.get('operational_status', '')).strip()
    lc_status = raw_status.lower()
    update = parse_cbp_observation(port, lane)
    try:
        minutes = int(lane['delay_minutes']) if str(lane.get('delay_minutes', '')).strip() else None
        if minutes is not None and not 0 <= minutes <= 720:
            minutes = None
    except (ValueError, TypeError, KeyError):
        minutes = None
    try:
        lanes = int(lane['lanes_open']) if str(lane.get('lanes_open', '')).strip() else None
    except (ValueError, TypeError, KeyError):
        lanes = None
    if 'closed' in lc_status:
        status, minutes = 'closed', None
    elif lc_status in ('n/a', 'not applicable'):
        status, minutes = 'not_applicable', None
    elif 'pending' in lc_status or not lc_status:
        status, minutes = 'unavailable', None
    elif minutes is not None:
        status = 'reported'
    else:
        status = 'unavailable'
    return {'minutes': minutes, 'status': status, 'observation_at': update, 'lanes_open': lanes}


def normalize_cbp(text):
    feed = json.loads(text)
    if not isinstance(feed, list):
        raise ValueError('CBP payload is not an array')
    out = {}
    for port in feed:
        key = port_id(port.get('crossing_name', ''))
        if key not in CROSSING_NAMES or canonical(port.get('port_name', '')) != 'detroit':
            continue
        passenger = port.get('passenger_vehicle_lanes') or {}
        out[key] = {
            'source': 'CBP',
            'standard': normalize_lane(passenger.get('standard_lanes'), port),
            'nexus': normalize_lane(passenger.get('NEXUS_SENTRI_lanes'), port),
            'port_status': str(port.get('port_status', '')).strip() or None,
            'notice': str(port.get('construction_notice', '')).strip()[:450] or None,
        }
    if not out:
        raise ValueError('CBP feed contains no matching Detroit crossings')
    return out


def parse_wait(raw):
    raw = re.sub(r'\s+', ' ', str(raw)).strip().lower()
    if raw in ('no delay', 'no delays'):
        return {'status': 'reported', 'minutes': 0}
    if raw in ('closed', 'temporarily closed', 'lanes closed'):
        return {'status': 'closed', 'minutes': None}
    if raw in ('n/a', '--', '-', '', 'not applicable', 'update pending', 'unavailable'):
        return {'status': 'unavailable', 'minutes': None}
    if not re.fullmatch(r'(?:\d+\s*hours?\s*)?(?:\d+\s*minutes?|\d+\s*min)?', raw) or not re.search(r'\d', raw):
        return {'status': 'unavailable', 'minutes': None}
    hour = re.search(r'(\d+)\s*hours?', raw)
    minute = re.search(r'(\d+)\s*(?:minutes?|min)', raw)
    mins = int(hour.group(1)) * 60 if hour else 0
    mins += int(minute.group(1)) if minute else 0
    return {'status': 'reported', 'minutes': mins} if mins <= 720 else {'status': 'unavailable', 'minutes': None}


class RowParser(HTMLParser):
    """Capture cell text in table rows, regardless of incidental nested markup."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self.row = None
        self.cell = None
        self.cell_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []
            self.cell_depth = 1
        elif self.cell is not None:
            self.cell_depth += 1

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
            self.cell_depth = 0
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif self.cell is not None and self.cell_depth > 1:
            self.cell_depth -= 1

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data + ' ')


def normalize_cbsa_table_rows(rows):
    out = {}
    for row in rows:
        if len(row) < 4:
            continue
        key = port_id(row[0])
        if not key:
            continue
        # Explicit 4-column table: crossing, commercial, travellers, updated.
        # Some editions put a location in a separate cell, thus use last 3 cells.
        traveller, stamp = row[-2], row[-1]
        obs = parse_datetime(stamp)
        if obs is None:
            continue  # Reject ambiguous rows; never substitute retrieval time.
        reading = parse_wait(traveller)
        out[key] = {'source': 'CBSA', 'standard': {**reading, 'observation_at': iso(obs), 'lanes_open': None},
                    'nexus': None, 'port_status': None, 'notice': None}
    if not out:
        raise ValueError('CBSA table has no matching dated Windsor crossings')
    return out


def normalize_cbsa_html(text):
    p = RowParser()
    p.feed(text)
    return normalize_cbsa_table_rows(p.rows)


def normalize_cbsa_csv(text):
    lines = list(csv.reader(io.StringIO(text)))
    # Feed editions can have an extra location column. Only accept rows with
    # an identified crossing, a valid published timestamp and a recognized wait.
    return normalize_cbsa_table_rows(lines)


def empty_snapshot():
    return {
        'schema': 'nexus-live-v1',
        'generated_at': now_utc(),
        'sources': {},
        'directions': {'us': {}, 'ca': {}},
        'disclaimer': 'Official border inspection wait estimates only; road approach delays excluded.',
    }


def collect(cbp_text=None, cbsa_text=None, cbsa_format='auto'):
    result = empty_snapshot()
    try:
        cbp = normalize_cbp(cbp_text if cbp_text is not None else get_text(CBP_URL))
        result['directions']['us'] = cbp
        result['sources']['cbp'] = {'status': 'ok', 'retrieved_at': now_utc(), 'url': CBP_URL,
                                    'coverage': len(cbp)}
    except Exception as exc:
        result['sources']['cbp'] = {'status': 'error', 'retrieved_at': now_utc(), 'url': CBP_URL,
                                    'error': f'{type(exc).__name__}: {str(exc)[:160]}'}

    # Prefer official CSV; retry using the CBSA official HTML table if it
    # fails or changes format. This fallback is not a third-party proxy.
    issues = []
    candidates = [(CBSA_CSV_URL, 'csv'), (CBSA_HTML_URL, 'html')]
    if cbsa_text is not None:
        candidates = [('fixture:cbsa', cbsa_format if cbsa_format != 'auto' else 'csv')]
    for url, mode in candidates:
        try:
            raw = cbsa_text if cbsa_text is not None else get_text(url)
            if mode == 'csv':
                data = normalize_cbsa_csv(raw)
            else:
                data = normalize_cbsa_html(raw)
            result['directions']['ca'] = data
            result['sources']['cbsa'] = {'status': 'ok', 'retrieved_at': now_utc(),
                                         'url': url if not url.startswith('fixture:') else CBSA_CSV_URL,
                                         'coverage': len(data)}
            break
        except Exception as exc:
            issues.append(f'{mode}: {type(exc).__name__}: {str(exc)[:100]}')
    if 'cbsa' not in result['sources']:
        result['sources']['cbsa'] = {'status': 'error', 'retrieved_at': now_utc(),
                                    'url': CBSA_CSV_URL, 'error': '; '.join(issues)[:300]}
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='data/live.json')
    ap.add_argument('--cbp-fixture')
    ap.add_argument('--cbsa-fixture')
    ap.add_argument('--cbsa-format', choices=['csv', 'html'], default='csv')
    args = ap.parse_args()
    raw_cbp = Path(args.cbp_fixture).read_text(encoding='utf-8') if args.cbp_fixture else None
    raw_cbsa = Path(args.cbsa_fixture).read_text(encoding='utf-8') if args.cbsa_fixture else None
    payload = collect(raw_cbp, raw_cbsa, args.cbsa_format)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Generated {path}: ' + ', '.join(f'{k}: {v["status"]} ({v.get("coverage", 0)}/3)' for k,v in payload['sources'].items()))
    if any(v['status'] != 'ok' or v.get('coverage') != 3 for v in payload['sources'].values()):
        print('WARNING: One or more feeds degraded or incomplete. Missing readings are intentionally not populated.', file=sys.stderr)


if __name__ == '__main__':
    main()
