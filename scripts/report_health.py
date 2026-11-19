#!/usr/bin/env python3
"""Non-blocking source-quality diagnostics for the published Nexus snapshot."""
from datetime import datetime, timezone
from pathlib import Path
import json
import os
import sys


def age_minutes(stamp, now):
    try:
        dt = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return None
        minutes = (now - dt.astimezone(timezone.utc)).total_seconds() / 60
        return round(minutes, 1) if minutes >= -2 else None
    except (TypeError, ValueError):
        return None


def diagnostic_rows(data, now):
    rows = []
    for name, source in data.get('sources', {}).items():
        direction = 'us' if name == 'cbp' else 'ca' if name == 'cbsa' else None
        obs = []
        if direction:
            for port in data.get('directions', {}).get(direction, {}).values():
                raw = port.get('standard') if isinstance(port, dict) else None
                age = age_minutes(raw.get('observation_at'), now) if isinstance(raw, dict) else None
                if age is not None:
                    obs.append(age)
        elif name == 'dwt':
            for reading in data.get('supplemental', {}).get('dwt', {}).values():
                if isinstance(reading, dict):
                    age = age_minutes(reading.get('observation_at'), now)
                    if age is not None:
                        obs.append(age)
        last = age_minutes(source.get('last_success_at') or source.get('retrieved_at'), now)
        status = source.get('status', 'unknown')
        if source.get('retained_previous'):
            status += ' (previous report only)'
        if source.get('cache_reused'):
            status += ' (schedule cache)'
        observation = f'{min(obs)}–{max(obs)} min' if obs else 'not supplied'
        rows.append((name, status, f'{last} min' if last is not None else 'unknown', observation))
    return rows


def publication_gap_minutes(data):
    """Elapsed time between known successive *published* snapshots; not a run SLA."""
    try:
        previous = data.get('collection', {}).get('previous_snapshot_at')
        current = data.get('generated_at')
        if not isinstance(previous, str) or not isinstance(current, str):
            return None
        a = datetime.fromisoformat(previous.replace('Z', '+00:00'))
        b = datetime.fromisoformat(current.replace('Z', '+00:00'))
        if a.tzinfo is None or b.tzinfo is None:
            return None
        elapsed = (b.astimezone(timezone.utc) - a.astimezone(timezone.utc)).total_seconds() / 60
        return round(elapsed, 1) if elapsed >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def gap_warning_threshold(data):
    """Provisional operational signal, not an official agency publishing guarantee."""
    cadence = data.get('collection', {}).get('configured_interval_minutes')
    if not isinstance(cadence, (int, float)) or not 1 <= cadence <= 120:
        cadence = 10
    return max(30, 3 * cadence)


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else 'data/live.json')
    data = json.loads(path.read_text(encoding='utf-8'))
    now = datetime.now(timezone.utc)
    rows = diagnostic_rows(data, now)
    lines = ['## Nexus collection health',
             '', f"Published: `{data.get('generated_at', 'unknown')}`; trigger: `{data.get('collection', {}).get('trigger', '?')}`.",
             '', '| Source | Fetch state | Last successful fetch | Observation age (range) |',
             '|---|---|---|---|']
    for name, state, retrieved, observed in rows:
        lines.append(f'| {name} | {state} | {retrieved} | {observed} |')
    lines.append('')
    tracker = data.get('collection', {}).get('observation_tracker', {})
    tracker_summary = tracker.get('summary', {}) if isinstance(tracker, dict) else {}
    if tracker_summary:
        lines.append('Observation first-seen tracking (new agency timestamps / changed values / baseline records):')
        for source_name in ('cbp', 'cbsa'):
            counts = tracker_summary.get(source_name, {})
            lines.append(f'- {source_name}: {counts.get("new_observation_times", 0)} / '
                         f'{counts.get("changed_values", 0)} / {counts.get("new_baseline_records", 0)}'
                         + (' (source fetched)' if counts.get('source_fetched') else ' (reused or unavailable)'))
        lines.append('')
    gap = publication_gap_minutes(data)
    threshold = gap_warning_threshold(data)
    if gap is None:
        lines.append('Previous published snapshot: unavailable. Collection interval could not be measured.')
    else:
        lines.append(f'Elapsed since previous known published snapshot: {gap} min '
                     f'(warning heuristic: >{threshold:g} min; GitHub schedule is best-effort).')
    lines.append('')
    lines.append('Observation age is the agency-provided measurement time, not the fetch time. Older reports are not current. Source failure never upgrades cached data.')
    output = '\n'.join(lines) + '\n'
    print(output)
    if path_to_summary := os.getenv('GITHUB_STEP_SUMMARY'):
        with open(path_to_summary, 'a', encoding='utf-8') as f:
            f.write(output)
    failed = [name for name, source in data['sources'].items() if name in ('cbp', 'cbsa') and source.get('status') != 'ok']
    if failed:
        print('::warning title=Nexus border sources degraded::' + ', '.join(failed))
    if gap is not None and gap > threshold:
        print(f'::warning title=Nexus publication gap::{gap} minutes between '
              'known published snapshots; cause not yet established')


if __name__ == '__main__':
    main()
