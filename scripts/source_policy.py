"""Beta collection policies, not claims about official agency publication cadence.

Keep primary checks aligned to the existing 10-minute workflow. Source-specific
intervals skip redundant API requests, including those induced by code pushes.
Reassess these provisional values after recording agency-observation changes.
"""
from datetime import datetime, timezone

# A 9-minute guard permits a 10-minute scheduled collection with small jitter.
MIN_CHECK_INTERVAL_MINUTES = {
    'cbp': 9,
    'cbsa': 9,
    'dwt': 30,
    'ontario511': 10,
    'ontario511_alerts': 10,
    'ontario511_road_conditions': 30,
    'ontario511_construction': 60,
    'cbsa_hours': 1440,
}


def reuse_cached_source(result, previous, name, group, field, now=None):
    """Carry forward a *successful* source, keeping its original retrieval time.

    Returns False when a fetch is due, the previous source failed, or the
    cached payload is missing. An empty list of official alerts is valid data.
    """
    if not isinstance(previous, dict):
        return False
    src = previous.get('sources', {}).get(name)
    if not isinstance(src, dict) or src.get('status') != 'ok' or src.get('retained_previous'):
        return False
    previous_data = previous.get(group, {})
    if not isinstance(previous_data, dict):
        return False
    old = previous_data.get(field)
    if not isinstance(old, (dict, list)):
        return False
    if not old and name in ('cbp', 'cbsa', 'dwt', 'cbsa_hours'):
        return False
    stamp = src.get('last_success_at') or src.get('retrieved_at')
    if not isinstance(stamp, str):
        return False
    try:
        last = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if last.tzinfo is None:
            return False
        age = ((now or datetime.now(timezone.utc)) - last.astimezone(timezone.utc)).total_seconds()
    except (TypeError, ValueError, OverflowError):
        return False
    minimum = MIN_CHECK_INTERVAL_MINUTES.get(name, 0)
    if age < -120 or age >= minimum * 60:
        return False
    result[group][field] = old
    result['sources'][name] = {
        **src,
        'retrieved_at': src.get('retrieved_at') or stamp,
        'last_success_at': stamp,
        'cache_reused': True,
        'cache_policy_minutes': minimum,
    }
    return True
