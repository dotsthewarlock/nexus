"""Beta-only observation detection metadata; no new upstream requests.

An agency observation timestamp is not an upstream publication timestamp.
First-seen records show when Nexus detected a changed official report, bounded
by the preceding *successful* collection when known. A repeated retrieval
never renews the first-seen or agency observation times.
"""
from hashlib import sha256
import json

TRACKED = {'us': ('standard', 'nexus'), 'ca': ('standard',)}


def fingerprint(reading, fields):
    value = {name: reading.get(name) for name in fields}
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)
    return sha256(raw.encode('utf-8')).hexdigest()[:20]


def record_primary_observations(result, previous):
    at = result['generated_at']
    previous = previous if isinstance(previous, dict) else {}
    prior_collection = previous.get('collection', {})
    prior_collection = prior_collection if isinstance(prior_collection, dict) else {}
    prior_tracker = prior_collection.get('observation_tracker', {})
    prior_records = prior_tracker.get('records', {}) if isinstance(prior_tracker, dict) else {}
    if not isinstance(prior_records, dict):
        prior_records = {}

    records = {}
    summary = {}
    for direction, lanes in TRACKED.items():
        key = 'cbp' if direction == 'us' else 'cbsa'
        source = result.get('sources', {}).get(key, {})
        source = source if isinstance(source, dict) else {}
        successful_new_fetch = source.get('status') == 'ok' and not source.get('cache_reused')
        previous_source = previous.get('sources', {}).get(key, {})
        previous_source = previous_source if isinstance(previous_source, dict) else {}
        previous_checked = (previous_source.get('last_success_at') or previous_source.get('retrieved_at')
                            if previous_source.get('status') == 'ok' else None)
        changed_reports = 0
        changed_values = 0
        baseline = 0
        for crossing, port in result.get('directions', {}).get(direction, {}).items():
            if not isinstance(port, dict):
                continue
            for lane in lanes:
                reading = port.get(lane)
                if not isinstance(reading, dict):
                    continue
                record_key = f'{key}.{crossing}.{lane}'
                prior = prior_records.get(record_key)
                prior = prior if isinstance(prior, dict) else {}
                if not successful_new_fetch:
                    if prior:
                        records[record_key] = prior
                    continue
                value_fingerprint = fingerprint(reading,
                    ('minutes', 'status', 'lanes_open', 'reported_status'))
                report_fingerprint = fingerprint(reading,
                    ('minutes', 'status', 'lanes_open', 'reported_status', 'observation_at'))
                same_report = prior.get('report_fingerprint') == report_fingerprint
                same_value = prior.get('value_fingerprint') == value_fingerprint
                first_seen = prior.get('first_seen_at') if same_report else at
                value_changed_at = prior.get('last_value_change_at') if same_value else at
                if not prior:
                    baseline += 1
                elif not same_report:
                    if prior.get('observation_at') != reading.get('observation_at'):
                        changed_reports += 1
                    if not same_value:
                        changed_values += 1
                records[record_key] = {
                    'observation_at': reading.get('observation_at'),
                    'first_seen_at': first_seen,
                    'last_value_change_at': value_changed_at,
                    'previous_checked_at': (
                        prior.get('previous_checked_at') if same_report
                        else previous_checked if prior else None
                    ),
                    'report_fingerprint': report_fingerprint,
                    'value_fingerprint': value_fingerprint,
                    'ingestion_path': 'server_collector',
                }
        summary[key] = {
            'new_observation_times': changed_reports,
            'changed_values': changed_values,
            'new_baseline_records': baseline,
            'source_fetched': successful_new_fetch,
        }
    result['collection']['observation_tracker'] = {
        'schema': 'nexus-observation-tracker-v1',
        'records': records,
        'summary': summary,
    }
