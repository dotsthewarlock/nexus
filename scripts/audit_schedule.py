#!/usr/bin/env python3
"""Audit GitHub Actions schedule executions after a successful Nexus workflow run.

This reports evidence; it cannot wake a workflow that never starts. Expected
cron slots are not GitHub delivery guarantees. No tokens or source credentials
are written to the public site or to workflow logs.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

API_ROOT = 'https://api.github.com'
MAX_BYTES = 4_000_000
RUN_PAGE_SIZE = 100
MAX_PAGES = 4
UTC = timezone.utc


def timestamp(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Timestamp missing')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timestamp has no time zone')
    return parsed.astimezone(UTC)


def cron_minutes(workflow_text):
    """Understand the repo's single hourly minute-list cron, or report unknown.

    Do not attempt to interpret arbitrary GitHub cron expressions. Unsupported
    schedules result in no numeric expected-slot claims.
    """
    values = re.findall(
        r"^\s*-\s*cron\s*:\s*['\"]?([^'\"#\n]+)", workflow_text, re.M
    )
    if len(values) != 1:
        raise ValueError('Expected one cron entry')
    fields = values[0].strip().split()
    if len(fields) != 5 or fields[1:] != ['*', '*', '*', '*']:
        raise ValueError('Cron syntax not supported by this audit')
    minute_field = fields[0]
    if re.fullmatch(r'\*/[1-9]\d?', minute_field):
        stride = int(minute_field[2:])
        values = list(range(0, 60, stride))
    else:
        parts = minute_field.split(',')
        if not parts or any(not re.fullmatch(r'\d{1,2}', p) for p in parts):
            raise ValueError('Cron minutes must be a numeric list')
        values = [int(p) for p in parts]
    if len(set(values)) != len(values) or any(x < 0 or x > 59 for x in values):
        raise ValueError('Cron minutes invalid or duplicated')
    return sorted(values)


def scheduled_slots(start, end, minutes):
    """Return UTC cron slots strictly after start, through end inclusive."""
    if end <= start:
        return []
    start_hour = start.replace(minute=0, second=0, microsecond=0)
    result = []
    hour = start_hour
    while hour <= end:
        for minute in minutes:
            candidate = hour + timedelta(minutes=minute)
            if start < candidate <= end:
                result.append(candidate)
        hour += timedelta(hours=1)
    return result


class RejectRedirects(HTTPRedirectHandler):
    """Never forward a GitHub token to a redirected URL."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_json(path, token='', opener=None):
    if not path.startswith('/repos/'):
        raise ValueError('Only repository API paths are permitted')
    request = Request(
        API_ROOT + path,
        headers={
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Nexus-Schedule-Audit/1.0',
            **({'Authorization': 'Bearer ' + token} if token else {}),
        },
    )
    opener = opener or build_opener(RejectRedirects())
    with opener.open(request, timeout=8) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('GitHub API response exceeded size limit')
    return json.loads(body)


def validate_repo(repo):
    if not isinstance(repo, str) or not re.fullmatch(
        r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo
    ):
        raise ValueError('Invalid GitHub repository name')
    return repo


def load_evidence(repo, workflow='publish.yml', token='', fetch=fetch_json):
    """Read workflow-edit time and schedule-filtered runs; no mutation."""
    repo = validate_repo(repo)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.yml', workflow):
        raise ValueError('Invalid workflow filename')
    commits = fetch('/repos/' + repo + '/commits?' + urlencode({
        'path': '.github/workflows/' + workflow, 'per_page': 1
    }), token)
    if not isinstance(commits, list) or not commits:
        raise ValueError('Workflow change history unavailable')
    latest_commit = commits[0].get('commit', {})
    changed_at = timestamp(
        latest_commit.get('committer', {}).get('date')
    )
    entries = []
    complete = False
    for page in range(1, MAX_PAGES + 1):
        data = fetch('/repos/' + repo + '/actions/workflows/' + workflow +
                     '/runs?' + urlencode({
                         'event': 'schedule', 'per_page': RUN_PAGE_SIZE,
                         'page': page
                     }), token)
        if not isinstance(data, dict) or not isinstance(data.get('workflow_runs'), list):
            raise ValueError('Workflow run history unavailable')
        entries.extend(data['workflow_runs'])
        total = data.get('total_count')
        if isinstance(total, int) and len(entries) >= total:
            complete = True
            break
        if len(data['workflow_runs']) < RUN_PAGE_SIZE:
            complete = True
            break
    return changed_at, entries, complete


def assess(now, changed_at, runs, minutes, complete=True,
           window_hours=24, grace_minutes=20):
    """Assess only cron slots after the current workflow revision stabilized.

    Compare counts of due slots and schedule-triggered executions, not the
    agency's source-measurement cadence or push-triggered deployments.
    """
    now = now.astimezone(UTC)
    changed_at = changed_at.astimezone(UTC)
    baseline = max(now - timedelta(hours=window_hours), changed_at)
    cutoff = now - timedelta(minutes=grace_minutes)
    due = scheduled_slots(baseline, cutoff, minutes)
    observed = []
    latest = None
    for run in runs:
        if not isinstance(run, dict) or run.get('event') != 'schedule':
            continue
        try:
            created = timestamp(run.get('created_at'))
        except (TypeError, ValueError, OverflowError):
            continue
        if created <= now and (latest is None or created > latest):
            latest = created
        if baseline < created <= cutoff:
            observed.append(created)
    # If pagination is incomplete but the fetched runs reach before our
    # baseline, history is still sufficient for this window.
    oldest = []
    for run in runs:
        try:
            if run.get('event') == 'schedule':
                oldest.append(timestamp(run.get('created_at')))
        except (AttributeError, TypeError, ValueError, OverflowError):
            pass
    covered = complete or (bool(oldest) and min(oldest) <= baseline)
    shortfall = max(0, len(due) - len(observed))
    if not covered:
        status = 'incomplete'
    elif len(due) < 3:
        status = 'warming_up'
    elif shortfall >= 3:
        status = 'gap'
    else:
        status = 'tracking'
    return {
        'status': status, 'baseline': baseline, 'cutoff': cutoff,
        'expected': len(due), 'observed': len(observed),
        'shortfall': shortfall, 'last_schedule': latest,
        'history_complete_for_window': covered,
        'grace_minutes': grace_minutes, 'workflow_changed_at': changed_at,
    }


def summary(report, run_event='unknown'):
    def fmt(value):
        return value.strftime('%Y-%m-%d %H:%M UTC') if value else 'None in retrieved history'
    lines = [
        '### Nexus scheduled-publishing audit (diagnostic only)',
        '',
        '| Measure | Result |', '|---|---|',
        f'| Current run trigger | {run_event} |',
        f'| Latest workflow change | {fmt(report["workflow_changed_at"])} |',
        f'| Evaluation baseline | {fmt(report["baseline"])} |',
        f'| Count through (delay allowance) | {fmt(report["cutoff"])} |',
        f'| Configured cron slots due | {report["expected"]} |',
        f'| Schedule-triggered run starts | {report["observed"]} |',
        f'| Observed count shortfall | {report["shortfall"]} |',
        f'| Most recent scheduled run | {fmt(report["last_schedule"])} |',
        f'| Audit status | {report["status"]} |',
        '',
        'Slot counts start only after the most recent workflow-file change; '
        f'the last {report["grace_minutes"]} minutes are excluded for scheduler delay. '
        'A shortfall signals a possible missed/delayed execution, not its cause. '
        'Push-triggered and manual publishing do not count as scheduled runs. '
        'This check runs **only when a GitHub job starts**, so it cannot detect '
        'or alert in real time if all GitHub jobs stop.',
        '',
    ]
    return '\n'.join(lines)


def write_summary(message):
    print(message)
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if path:
        with open(path, 'a', encoding='utf-8') as out:
            out.write('\n' + message + '\n')


def main(argv=None, fetch=fetch_json, now=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workflow-file', default='.github/workflows/publish.yml')
    parser.add_argument('--workflow', default='publish.yml')
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'dotsthewarlock/nexus'))
    parser.add_argument('--window-hours', type=int, default=24)
    parser.add_argument('--grace-minutes', type=int, default=20)
    opts = parser.parse_args(argv)
    try:
        if not (1 <= opts.window_hours <= 48 and 5 <= opts.grace_minutes <= 60):
            raise ValueError('Unsupported observation window')
        minutes = cron_minutes(Path(opts.workflow_file).read_text(encoding='utf-8'))
        changed_at, runs, complete = load_evidence(
            opts.repo, opts.workflow,
            token=os.environ.get('GH_TOKEN', ''), fetch=fetch
        )
        report = assess(now or datetime.now(UTC), changed_at, runs, minutes,
                        complete, opts.window_hours, opts.grace_minutes)
        write_summary(summary(report, os.environ.get('GITHUB_EVENT_NAME', 'unknown')))
        if report['status'] == 'gap':
            print('::warning title=Possible Nexus schedule gap::'
                  'Several expected cron slots had no corresponding scheduled '
                  'starts in the evaluated stable workflow window.')
        elif report['status'] == 'incomplete':
            print('::warning title=Nexus schedule audit incomplete::'
                  'GitHub Actions history did not cover the evaluated window.')
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        # Do not echo exception text or URLs: the GitHub token is never logged.
        write_summary('### Nexus scheduled-publishing audit\n\n'
                      'Unable to verify schedule execution history. '
                      'No conclusion about scheduling reliability can be drawn.')
        print('::warning title=Nexus schedule audit unavailable::'
              'Could not validate the cron, GitHub run history, or workflow revision.')
    # Monitoring is informational; never block collection or Pages publishing.
    return 0


if __name__ == '__main__':
    sys.exit(main())
