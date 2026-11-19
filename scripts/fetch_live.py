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
import os
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo
try:
    from scripts import ontario_511, source_policy, observation_history
except ModuleNotFoundError:
    import ontario_511
    import source_policy
    import observation_history

UTC = timezone.utc
EASTERN = ZoneInfo('America/Toronto')
CBP_URL = 'https://bwt.cbp.gov/api/waittimes'
CBSA_CSV_URL = 'https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv'
CBSA_HTML_URL = 'https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html'
CBSA_HOURS_URL = 'https://www.cbsa-asfc.gc.ca/data/cbsa-offices-services-bureaux-asfc-en.json'
DWT_URL = 'https://api.dwtunnel.com/api/traffic/conditionspublic'
ONTARIO_511_URL = ontario_511.ENDPOINTS['ontario511'][1]
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
        blob = response.read(8_000_001)
        if len(blob) > 8_000_000:
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
    return {'minutes': minutes, 'status': status, 'observation_at': update, 'lanes_open': lanes,
            'reported_status': raw_status or None}


def optional_integer(value):
    try:
        result = int(value)
        return result if result >= 0 else None
    except (TypeError, ValueError):
        return None


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
        commercial = port.get('commercial_vehicle_lanes') or {}
        pedestrians = port.get('pedestrian_lanes') or {}
        out[key] = {
            'source': 'CBP',
            'standard': normalize_lane(passenger.get('standard_lanes'), port),
            'nexus': normalize_lane(passenger.get('NEXUS_SENTRI_lanes'), port),
            'ready': normalize_lane(passenger.get('ready_lanes'), port),
            'commercial': normalize_lane(commercial.get('standard_lanes'), port),
            'fast': normalize_lane(commercial.get('FAST_lanes'), port),
            'pedestrian': normalize_lane(pedestrians.get('standard_lanes'), port),
            'passenger_max_lanes': optional_integer(passenger.get('maximum_lanes')),
            'commercial_max_lanes': optional_integer(commercial.get('maximum_lanes')),
            'published_port_hours': str(port.get('hours', '')).strip()[:100] or None,
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
        commercial, traveller, stamp = row[-3], row[-2], row[-1]
        obs = parse_datetime(stamp)
        if obs is None:
            continue  # Reject ambiguous rows; never substitute retrieval time.
        reading = parse_wait(traveller)
        trucks = parse_wait(commercial)
        out[key] = {'source': 'CBSA', 'standard': {**reading, 'observation_at': iso(obs), 'lanes_open': None},
                    'commercial': {**trucks, 'observation_at': iso(obs), 'lanes_open': None},
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


def normalize_cbsa_nexus_hours(text):
    """Official CBSA offices directory: published *Canada-bound* NEXUS hours.

    Raw labels are preserved to avoid assigning unsupported holiday semantics.
    Published schedules never establish current physical lane availability.
    """
    payload = json.loads(text)
    offices = payload.get('offices') if isinstance(payload, dict) else None
    if not isinstance(offices, list):
        raise ValueError('CBSA office directory missing offices')
    result = {}
    for office in offices:
        if not isinstance(office, dict):
            continue
        key = port_id(office.get('name', ''))
        if not key:
            continue
        groups = []
        for group in office.get('hours', []):
            if not isinstance(group, dict) or 'nexus' not in str(group.get('labelEn', '')).lower():
                continue
            rows = []
            for row in group.get('officeHours', []):
                if not isinstance(row, dict):
                    continue
                rows.append({
                    'label': str(row.get('labelEn', '')).strip()[:120],
                    'start': str(row.get('start', '')).strip()[:10] or None,
                    'end': str(row.get('end', '')).strip()[:10] or None,
                    'custom': str(row.get('customEn', '')).strip()[:80] or None,
                })
            if rows:
                groups.append({'label': str(group.get('labelEn', ''))[:120], 'rows': rows})
        if groups:
            result[key] = {'source': 'CBSA', 'groups': groups}
    if not result:
        raise ValueError('No relevant NEXUS hours in CBSA office directory')
    return result


def normalize_dwt(text):
    """Preserve the operator's lane counts, NOT a claim that lanes are open.

    Source: public traffic conditions endpoint captured from www.dwtunnel.com.
    No separate NEXUS inspection wait is supplied.
    """
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ValueError('DWT payload is not an array')
    result = {}
    direction_names = {'detroit to windsor': 'ca', 'windsor to detroit': 'us'}
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        direction = direction_names.get(canonical(entry.get('Direction')))
        if not direction:
            continue
        raw_date = str(entry.get('DetailsDate', '')).strip()
        try:
            observed = datetime.strptime(raw_date, '%m/%d/%Y %I:%M:%S %p').replace(tzinfo=EASTERN)
            stamp = iso(observed)
        except ValueError:
            stamp = None
        counts = {}
        for name, field in [('car', 'CarLaneCount'), ('nexus', 'NexusLaneCount'), ('truck', 'TruckLaneCount')]:
            counts[name] = optional_integer(entry.get(field))
        result[direction] = {
            'source': 'DWT', 'observation_at': stamp, 'lane_counts': counts,
            'travel_time_category': str(entry.get('DetailsTravelTime', '')).strip()[:50] or None,
        }
    if not result:
        raise ValueError('No DWT directional records')
    return result


def normalize_ontario_events(text, observed_at=None):
    """Only broad Windsor-Essex vicinity alerts; NOT validated route impacts.

    A geographic bounding box may contain unrelated roads, so require
    401/3/EC Row road names and show 'regional advisory', not detour advice.
    """
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ValueError('Ontario 511 events payload is not an array')
    now = observed_at or datetime.now(UTC)
    out = []
    for e in payload:
        if not isinstance(e, dict):
            continue
        try:
            lat, lon = float(e.get('Latitude')), float(e.get('Longitude'))
        except (TypeError, ValueError):
            continue
        if not (42.08 <= lat <= 42.39 and -83.24 <= lon <= -82.72):
            continue
        road = str(e.get('RoadwayName') or '').strip()[:80]
        road_lc = canonical(road)
        if not any(word in road_lc for word in ('401', 'highway 3', 'hwy 3', 'ec row', 'e c row')):
            continue
        try:
            begin = int(e['StartDate'])
            end = int(e['PlannedEndDate'])
            if (begin > now.timestamp() or end < now.timestamp()):
                continue
        except (TypeError, ValueError, KeyError):
            pass  # No unsupported assumption about a missing end date.
        out.append({
            'id': str(e.get('ID') or '')[:40], 'roadway': road,
            'direction': str(e.get('DirectionOfTravel') or '')[:40],
            'description': str(e.get('Description') or '')[:280],
            'type': str(e.get('EventType') or '')[:60],
            'is_full_closure': e.get('IsFullClosure') is True,
            'severity': str(e.get('Severity') or '')[:60],
            'latitude': lat, 'longitude': lon,
        })
    return out[:30]


def empty_snapshot():
    return {
        'schema': 'nexus-live-v2',
        'generated_at': now_utc(),
        'collection': {
            # Used for diagnostics only; not proof that a scheduled trigger is healthy.
            'trigger': os.environ.get('GITHUB_EVENT_NAME', 'local')[:30],
            'run_id': os.environ.get('GITHUB_RUN_ID', '')[:30] or None,
            'configured_interval_minutes': 10,
            'previous_snapshot_at': None,
        },
        'sources': {},
        'supplemental': {'dwt': {}, 'ontario511_events': [], 'ontario511_construction': [],
                         'ontario511_road_conditions': [], 'ontario511_alerts': [], 'cbsa_nexus_hours': {}},
        'directions': {'us': {}, 'ca': {}},
        'disclaimer': 'Official border inspection wait estimates only; road approach delays excluded.',
    }


def validated_previous(payload):
    """Only an older Nexus snapshot can supply clearly labeled last-known reports.

    A failed/blank/non-Nexus response must never become a new source of truth.
    """
    if not isinstance(payload, dict) or payload.get('schema') != 'nexus-live-v2':
        return None
    if not all(isinstance(payload.get(key), dict) for key in ('sources', 'directions', 'supplemental')):
        return None
    try:
        dt = datetime.fromisoformat(payload['generated_at'].replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return None
        elapsed = (datetime.now(UTC) - dt.astimezone(UTC)).total_seconds()
        if elapsed < -120 or elapsed > 48 * 3600:
            return None
    except (TypeError, ValueError, KeyError, AttributeError):
        return None
    return payload


def successful_before(previous, key, max_minutes):
    """Provenance of last successful retrieval; failed retries never advance it."""
    if previous is None:
        return None
    src = previous['sources'].get(key)
    if not isinstance(src, dict):
        return None
    if src.get('status') != 'ok' and src.get('retained_previous') is not True:
        return None
    stamp = src.get('last_success_at') or (src.get('retrieved_at') if src.get('status') == 'ok' else None)
    try:
        dt = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return None
        elapsed = (datetime.now(UTC) - dt.astimezone(UTC)).total_seconds()
        if elapsed < -120 or elapsed > max_minutes * 60:
            return None
    except (AttributeError, ValueError, TypeError):
        return None
    return stamp


def retain_on_failure(result, previous):
    """Preserve raw historical values only after source failure, never mark fresh.

    Client decision logic handles source status=error as OLD, not as a current
    measurement; stale port closures and NEXUS statuses do not count as live.
    """
    if previous is None:
        return
    directions={'cbp':'us','cbsa':'ca'}
    supplemental={'dwt':'dwt','cbsa_hours':'cbsa_nexus_hours',
        **{key: field for key, (_, _, field) in ontario_511.ENDPOINTS.items()}}
    for key in (*directions, *supplemental):
        source=result['sources'].get(key, {})
        if source.get('status') != 'error':
            continue
        ttl = 120 if key in directions else 30 if key == 'dwt' or key in ontario_511.ENDPOINTS else 2880
        prior_success=successful_before(previous,key,ttl)
        if not prior_success:
            continue
        if key in directions:
            old=previous['directions'].get(directions[key])
            if not isinstance(old,dict) or not old:
                continue
            result['directions'][directions[key]]=old
            source['coverage']=len(old)
        else:
            name=supplemental[key]
            old=previous['supplemental'].get(name)
            if not isinstance(old, (list,dict)) or not old:
                continue
            result['supplemental'][name]=old
            source['coverage']=len(old)
        source['retained_previous']=True
        source['last_success_at']=prior_success


def collect(cbp_text=None, cbsa_text=None, cbsa_format='auto', dwt_text=None, ontario_events_text=None, cbsa_hours_text=None, previous=None):
    previous=validated_previous(previous)
    result = empty_snapshot()
    result['collection']['previous_snapshot_at'] = previous['generated_at'] if previous else None
    if cbp_text is None and source_policy.reuse_cached_source(result, previous, 'cbp', 'directions', 'us'):
        pass
    else:
        try:
            cbp = normalize_cbp(cbp_text if cbp_text is not None else get_text(CBP_URL))
            result['directions']['us'] = cbp
            stamp=now_utc()
            result['sources']['cbp'] = {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp, 'url': CBP_URL,
                                        'coverage': len(cbp)}
        except Exception as exc:
            result['sources']['cbp'] = {'status': 'error', 'retrieved_at': now_utc(), 'url': CBP_URL,
                                        'error': f'{type(exc).__name__}: {str(exc)[:160]}'}

    # Prefer official CSV; retry using the CBSA official HTML table if it
    # fails or changes format. This fallback is not a third-party proxy.
    if cbsa_text is None and source_policy.reuse_cached_source(result, previous, 'cbsa', 'directions', 'ca'):
        pass
    else:
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
                stamp=now_utc()
                result['sources']['cbsa'] = {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp,
                                             'url': url if not url.startswith('fixture:') else CBSA_CSV_URL,
                                             'coverage': len(data)}
                break
            except Exception as exc:
                issues.append(f'{mode}: {type(exc).__name__}: {str(exc)[:100]}')
        if 'cbsa' not in result['sources']:
            result['sources']['cbsa'] = {'status': 'error', 'retrieved_at': now_utc(),
                                        'url': CBSA_CSV_URL, 'error': '; '.join(issues)[:300]}
    # NEXUS posted hours are schedules, not live conditions. Use the prior
    # verified version for up to a day; do not re-fetch every 10-minute cycle.
    fixture_mode = cbp_text is not None or cbsa_text is not None
    cached_hours=successful_before(previous,'cbsa_hours',1440) if not fixture_mode else None
    prev_hours=previous['supplemental'].get('cbsa_nexus_hours') if cached_hours else None
    if cbsa_hours_text is None and isinstance(prev_hours,dict) and prev_hours:
        result['supplemental']['cbsa_nexus_hours']=prev_hours
        result['sources']['cbsa_hours']={'status':'ok','retrieved_at':cached_hours,
            'last_success_at':cached_hours,'url':CBSA_HOURS_URL,
            'coverage':len(prev_hours),'cache_reused':True}
    else:
        try:
            if cbsa_hours_text is not None or not fixture_mode:
                hours = normalize_cbsa_nexus_hours(cbsa_hours_text if cbsa_hours_text is not None else get_text(CBSA_HOURS_URL))
                result['supplemental']['cbsa_nexus_hours'] = hours
                stamp=now_utc()
                result['sources']['cbsa_hours'] = {'status': 'ok', 'retrieved_at': stamp,
                    'last_success_at':stamp,'url': CBSA_HOURS_URL, 'coverage': len(hours)}
            else:
                result['sources']['cbsa_hours'] = {'status': 'not_collected', 'url': CBSA_HOURS_URL}
        except Exception as exc:
            result['sources']['cbsa_hours'] = {'status': 'error', 'retrieved_at': now_utc(),
                'url': CBSA_HOURS_URL, 'error': f'{type(exc).__name__}: {str(exc)[:160]}'}
    # DWT is a supplemental operator feed, not a replacement for inspection waits.
    # Tests with explicit CBP/CBSA fixture inputs never make external requests.
    fixture_mode = cbp_text is not None or cbsa_text is not None
    if not fixture_mode and dwt_text is None and source_policy.reuse_cached_source(result, previous, 'dwt', 'supplemental', 'dwt'):
        pass
    else:
        try:
            if dwt_text is not None or not fixture_mode:
                result['supplemental']['dwt'] = normalize_dwt(dwt_text if dwt_text is not None else get_text(DWT_URL))
                stamp=now_utc()
                result['sources']['dwt'] = {'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp,
                                             'url': DWT_URL, 'coverage': len(result['supplemental']['dwt'])}
            else:
                result['sources']['dwt'] = {'status': 'not_collected', 'url': DWT_URL}
        except Exception as exc:
            result['sources']['dwt'] = {'status': 'error', 'retrieved_at': now_utc(), 'url': DWT_URL,
                                        'error': f'{type(exc).__name__}: {str(exc)[:160]}'}
    # The key only exists in this server-side GitHub Actions process.
    key = os.getenv('ONTARIO_511_API_KEY', '').strip()
    fixture_inputs = {'ontario511': ontario_events_text}
    for name, (kind, endpoint, field) in ontario_511.ENDPOINTS.items():
        raw_fixture = fixture_inputs.get(name)
        if (raw_fixture is None and key and not fixture_mode and
                source_policy.reuse_cached_source(result, previous, name, 'supplemental', field)):
            continue
        try:
            if raw_fixture is not None or (key and not fixture_mode):
                if raw_fixture is None:
                    from urllib.parse import urlencode
                    # The credential-bearing URL is NEVER placed in output or logs.
                    request_url = endpoint + '?' + urlencode({'key': key, 'format': 'json', 'lang': 'en'})
                    raw = get_text(request_url)
                else:
                    raw = raw_fixture
                result['supplemental'][field] = ontario_511.normalize(raw, kind)
                stamp = now_utc()
                result['sources'][name] = {
                    'status': 'ok', 'retrieved_at': stamp, 'last_success_at': stamp,
                    'url': endpoint, 'attribution': ontario_511.ATTRIBUTION,
                    'coverage': len(result['supplemental'][field]),
                }
            else:
                result['sources'][name] = {
                    'status': 'not_collected' if fixture_mode and key else 'not_configured' if not key else 'not_collected',
                    'url': endpoint, 'attribution': ontario_511.ATTRIBUTION,
                }
        except Exception as exc:
            # Never format exception messages; urllib errors can contain the key.
            result['sources'][name] = {
                'status': 'error', 'retrieved_at': now_utc(), 'url': endpoint,
                'attribution': ontario_511.ATTRIBUTION, 'error': type(exc).__name__,
            }
    retain_on_failure(result, previous)
    observation_history.record_primary_observations(result, previous)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='data/live.json')
    ap.add_argument('--previous', help='Optional last published validated snapshot for stale-only recovery')
    ap.add_argument('--cbp-fixture')
    ap.add_argument('--cbsa-fixture')
    ap.add_argument('--cbsa-hours-fixture')
    ap.add_argument('--dwt-fixture')
    ap.add_argument('--ontario-events-fixture')
    ap.add_argument('--cbsa-format', choices=['csv', 'html'], default='csv')
    args = ap.parse_args()
    raw_cbp = Path(args.cbp_fixture).read_text(encoding='utf-8') if args.cbp_fixture else None
    raw_cbsa = Path(args.cbsa_fixture).read_text(encoding='utf-8') if args.cbsa_fixture else None
    raw_dwt = Path(args.dwt_fixture).read_text(encoding='utf-8') if args.dwt_fixture else None
    raw_ont = Path(args.ontario_events_fixture).read_text(encoding='utf-8') if args.ontario_events_fixture else None
    raw_hours = Path(args.cbsa_hours_fixture).read_text(encoding='utf-8') if args.cbsa_hours_fixture else None
    previous=None
    if args.previous and Path(args.previous).is_file():
        try:
            previous=json.loads(Path(args.previous).read_text(encoding='utf-8'))
        except (ValueError, OSError):
            print('WARNING: Prior snapshot invalid or unreadable; proceeding with fresh collection.', file=sys.stderr)
    payload = collect(raw_cbp, raw_cbsa, args.cbsa_format, raw_dwt, raw_ont, raw_hours, previous)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Generated {path}: ' + ', '.join(f'{k}: {v["status"]} ({v.get("coverage", 0)}/3)' for k,v in payload['sources'].items()))
    if any(payload['sources'].get(k, {}).get('status') != 'ok' or payload['sources'][k].get('coverage') != 3 for k in ('cbp','cbsa')):
        print('WARNING: One or more feeds degraded or incomplete. Missing readings are intentionally not populated.', file=sys.stderr)


if __name__ == '__main__':
    main()
