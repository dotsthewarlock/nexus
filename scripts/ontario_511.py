"""Ontario 511 public-feed normalization for Windsor-Essex regional context.

All fields are allowlisted. Coordinates identify vicinity only, NOT a verified
route delay. Documentation: https://511on.ca/developers/doc
"""
from datetime import datetime, timezone
import json
import re

ENDPOINTS = {
    'ontario511': ('events', 'https://511on.ca/api/v2/get/event', 'ontario511_events'),
    'ontario511_construction': ('construction', 'https://511on.ca/api/v2/get/constructionprojects', 'ontario511_construction'),
    'ontario511_road_conditions': ('road_conditions', 'https://511on.ca/api/v3/get/roadconditions', 'ontario511_road_conditions'),
    'ontario511_alerts': ('alerts', 'https://511on.ca/api/v2/get/alerts', 'ontario511_alerts'),
}
ATTRIBUTION = 'Ontario 511 · Ontario Ministry of Transportation'
ATTRIBUTION_URL = 'https://511on.ca/'
# Windsor–Essex vicinity, intentionally broader than any confirmed approach route.
BOUNDS = (42.14, 42.39, -83.27, -82.87)
ROAD_PATTERN = re.compile(
    r'\b(?:401|highway 3|hwy 3|route 3|e c row|ec row|'
    r'huron church|ojibway|sandwich st|sandwich street|'
    r'wyandotte|ouellette|goyeau|ambassador bridge|'
    r'gordie howe|detroit windsor tunnel|windsor detroit tunnel)\b'
)
LOCAL_PATTERN = re.compile(
    r'\b(?:windsor|lasalle|la salle|tecumseh|essex|ojibway|'
    r'huron church|ambassador bridge|gordie howe|sandwich|'
    r'detroit windsor tunnel|windsor detroit tunnel)\b'
)


def _clean(value, limit=280):
    return str(value).strip()[:limit] if value is not None else ''


def _words(value):
    return re.sub(r'[^a-z0-9]+', ' ', _clean(value, 2000).casefold()).strip()


def _timestamp(value):
    """Return source-supplied Unix seconds as ISO UTC; never substitute fetch time."""
    try:
        stamp = int(value)
        if stamp < 1262304000 or stamp > 4102444800:  # 2010..2099
            return None
        return datetime.fromtimestamp(stamp, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _coords(entry):
    for suffix in ('', 'Secondary'):
        try:
            lat, lon = float(entry.get('Latitude' + suffix)), float(entry.get('Longitude' + suffix))
            if BOUNDS[0] <= lat <= BOUNDS[1] and BOUNDS[2] <= lon <= BOUNDS[3]:
                return (round(lat, 6), round(lon, 6))
        except (ValueError, TypeError):
            continue
    return None


def _polyline_hits(encoded):
    """Google encoded polyline; return true only if geometry touches the region."""
    if isinstance(encoded, str):
        encoded = [encoded]
    if not isinstance(encoded, list):
        return False
    for part in encoded[:20]:
        if not isinstance(part, str) or len(part) > 100000:
            continue
        lat = lon = pos = count = 0
        previous = None
        try:
            while pos < len(part) and count < 20000:
                result = []
                for _ in range(2):
                    shift = value = 0
                    while True:
                        code = ord(part[pos]) - 63
                        pos += 1
                        if code < 0 or code > 63 or shift > 35:
                            raise ValueError('Invalid polyline')
                        value |= (code & 0x1f) << shift
                        shift += 5
                        if code < 0x20:
                            break
                    result.append(~(value >> 1) if value & 1 else (value >> 1))
                lat += result[0]
                lon += result[1]
                point = (lat / 1e5, lon / 1e5)
                if BOUNDS[0] <= point[0] <= BOUNDS[1] and BOUNDS[2] <= point[1] <= BOUNDS[3]:
                    return True
                if previous and (min(previous[0], point[0]) <= BOUNDS[1]
                                 and max(previous[0], point[0]) >= BOUNDS[0]
                                 and min(previous[1], point[1]) <= BOUNDS[3]
                                 and max(previous[1], point[1]) >= BOUNDS[2]):
                    return True
                previous = point
                count += 1
        except (ValueError, IndexError):
            continue
    return False


def _timing(start, end, now):
    """An ended report is omitted; upcoming work is explicitly tagged."""
    start_raw = _timestamp(start)
    end_raw = _timestamp(end)
    if end_raw and datetime.fromisoformat(end_raw.replace('Z', '+00:00')) < now:
        return None
    if start_raw:
        begins = datetime.fromisoformat(start_raw.replace('Z', '+00:00'))
        if begins > now:
            return 'upcoming' if (begins - now).days < 7 else None
        return 'reported_active'
    return 'timing_unknown'


def _event(entry, kind, now):
    road = _clean(entry.get('RoadwayName'), 80)
    if not ROAD_PATTERN.search(_words(road)):
        return None
    location = _coords(entry)
    if location is None and not _polyline_hits(entry.get('EncodedPolyline')):
        return None  # City text alone is insufficient for event placement.
    timing = _timing(entry.get('StartDate'), entry.get('PlannedEndDate'), now)
    if timing is None:
        return None
    lat, lon = location if location is not None else (None, None)
    return {
        'id': _clean(entry.get('ID'), 40),
        'category': kind,
        'roadway': road,
        'direction': _clean(entry.get('DirectionOfTravel'), 40),
        'description': _clean(entry.get('Description')),
        'type': _clean(entry.get('EventType') or ('roadwork' if kind == 'construction' else 'event'), 60),
        'is_full_closure': entry.get('IsFullClosure') is True,
        'severity': _clean(entry.get('Severity'), 60),
        'lanes_affected': _clean(entry.get('LanesAffected'), 80),
        'latitude': lat,
        'longitude': lon,
        'reported_at': _timestamp(entry.get('Reported')),
        'last_updated': _timestamp(entry.get('LastUpdated')),
        'start_at': _timestamp(entry.get('StartDate')),
        'planned_end_at': _timestamp(entry.get('PlannedEndDate')),
        'timing': timing,
    }


def _road_condition(entry):
    road = _clean(entry.get('RoadwayName'), 80)
    if not ROAD_PATTERN.search(_words(road)):
        return None
    location = _clean(entry.get('LocationDescription'))
    # 'Southwestern' alone and a province-wide highway name are not sufficient.
    if not (_polyline_hits(entry.get('EncodedPolyline')) or LOCAL_PATTERN.search(_words(location))):
        return None
    conditions = entry.get('Condition')
    if not isinstance(conditions, list):
        conditions = [conditions] if isinstance(conditions, str) else []
    conditions = [_clean(x, 100) for x in conditions[:6] if isinstance(x, str) and x.strip()]
    visibility = _clean(entry.get('Visibility'), 50)
    adverse = bool(re.search(r'\b(snow|ice|icy|slush|flood|drift|slippery|covered|packed|poor)\b',
                             _words(' '.join(conditions) + ' ' + visibility)))
    return {
        'category': 'road_condition',
        'roadway': road,
        'description': location,
        'conditions': conditions,
        'visibility': visibility,
        'drifting': _clean(entry.get('Drifting'), 30) or None,
        'region': _clean(entry.get('Region'), 40),
        'last_updated': _timestamp(entry.get('LastUpdated')),
        'is_adverse': adverse,
    }


def _alert(entry, now):
    message = _clean(entry.get('Message'), 450)
    notes = _clean(entry.get('Notes'), 250)
    terms = _words(message + ' ' + notes)
    # An alert for the whole 'Southwestern' region is not bridge-specific.
    if not (ROAD_PATTERN.search(terms) and LOCAL_PATTERN.search(terms)):
        return None
    timing = _timing(entry.get('StartTime'), entry.get('EndTime'), now)
    if timing is None:
        return None
    regions = entry.get('Regions')
    return {
        'id': _clean(entry.get('Id'), 40),
        'category': 'alert',
        'roadway': 'Windsor–Essex',
        'description': message,
        'notes': notes,
        'regions': [_clean(x, 40) for x in regions[:10] if isinstance(x, str)] if isinstance(regions, list) else [],
        'high_importance': entry.get('HighImportance') is True,
        'last_updated': _timestamp(entry.get('LastUpdated')),
        'start_at': _timestamp(entry.get('StartTime')),
        'planned_end_at': _timestamp(entry.get('EndTime')),
        'timing': timing,
    }


def normalize(text, kind, observed_at=None):
    """Validate an Ontario 511 array, project allowlisted fields, cap output."""
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ValueError('Expected Ontario 511 JSON array')
    now = observed_at or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Timezone-aware observation time required')
    items = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        if kind in ('events', 'construction'):
            item = _event(entry, kind, now)
        elif kind == 'road_conditions':
            item = _road_condition(entry)
        elif kind == 'alerts':
            item = _alert(entry, now)
        else:
            raise ValueError('Unsupported Ontario 511 feed type')
        if item:
            items.append(item)
        if len(items) == 60:
            break
    return items
