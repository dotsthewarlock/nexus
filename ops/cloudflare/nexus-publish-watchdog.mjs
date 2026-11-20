/*
 * M2c independent publication watchdog; Worker deployed dormant (no cron or secret).
 *
 * Cloudflare Cron: '8,18,28,38,48,58 * * * *' (UTC).
 * GitHub Actions native cron is '3,13,23,33,43,53 * * * *'.
 * This Worker verifies snapshot publication age, then dispatches only when
 * overdue and no publishing workflow is active/recent.
 *
 * A separate, single-repository GitHub fine-grained PAT with Actions:write
 * must be provisioned as the encrypted Worker secret GITHUB_ACTIONS_TOKEN.
 * Do not put the token in GitHub, source, logs, Pages assets or HTTP routes.
 * Repository changes alone do not activate Cron or provision any secret.
 */
export const SNAPSHOT_URL = 'https://dotsthewarlock.github.io/nexus/data/live.json';
export const PUBLISH_RUNS_URL = 'https://api.github.com/repos/dotsthewarlock/nexus/actions/workflows/publish.yml/runs?branch=main&per_page=8';
export const PUBLISH_DISPATCH_URL = 'https://api.github.com/repos/dotsthewarlock/nexus/actions/workflows/publish.yml/dispatches';
export const SNAPSHOT_RECENT_MS = 12 * 60 * 1000;
export const RECENT_RUN_MS = 8 * 60 * 1000;
const SKEW_MS = 2 * 60 * 1000;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export function snapshotIsRecent(value, nowMs = Date.now()) {
  if (!value || value.schema !== 'nexus-live-v2') return false;
  const at = typeof value.generated_at === 'string' ? Date.parse(value.generated_at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - at;
  return age >= -SKEW_MS && age <= SNAPSHOT_RECENT_MS;
}

export function hasActiveOrRecentRun(value, nowMs = Date.now()) {
  const runs = value?.workflow_runs;
  if (!Array.isArray(runs)) throw Error('GitHub publisher run history unavailable');
  for (const run of runs) {
    if (!run || typeof run !== 'object') continue;
    if (ACTIVE.has(run.status)) return true;
    const started = typeof run.created_at === 'string' ? Date.parse(run.created_at) : NaN;
    if (Number.isFinite(started) &&
        started >= nowMs - RECENT_RUN_MS && started <= nowMs + SKEW_MS) return true;
  }
  return false;
}

function authHeaders(secret) {
  return {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Nexus-Publication-Watchdog/1.0',
    'Authorization': 'Bearer ' + secret,
  };
}

async function isPublicSnapshotRecent(fetcher, nowMs) {
  // A changing query key bypasses persistent CDN caches. This is a
  // freshness check on the *Nexus publication*, not on CBP/CBSA reports.
  const url = SNAPSHOT_URL + '?watchdog=' + Math.floor(nowMs / 60000);
  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: {'Accept': 'application/json', 'Cache-Control': 'no-cache'},
      cache: 'no-store',
    });
    if (!response.ok) return false;
    return snapshotIsRecent(await response.json(), nowMs);
  } catch {
    // If the site itself is unreachable, dispatch a recovery collection
    // after checking whether the existing GitHub publisher is in flight.
    return false;
  }
}

export async function supervise(env, fetcher = fetch, nowMs = Date.now()) {
  const secret = env?.GITHUB_ACTIONS_TOKEN;
  if (typeof secret !== 'string' || !secret.trim())
    throw Error('GitHub dispatch secret is not configured');

  if (await isPublicSnapshotRecent(fetcher, nowMs))
    return 'recent_public_snapshot';

  const headers = authHeaders(secret);
  const historyResponse = await fetcher(PUBLISH_RUNS_URL, {
    method: 'GET', headers, cache: 'no-store',
  });
  if (!historyResponse.ok)
    throw Error('Could not inspect GitHub publishing workflow; HTTP ' + historyResponse.status);
  const history = await historyResponse.json();
  if (hasActiveOrRecentRun(history, nowMs))
    return 'publisher_already_running_or_recent';

  const dispatchResponse = await fetcher(PUBLISH_DISPATCH_URL, {
    method: 'POST', headers,
    body: JSON.stringify({ref:'main'}),
  });
  if (!dispatchResponse.ok)
    throw Error('GitHub publishing dispatch failed; HTTP ' + dispatchResponse.status);

  // GitHub may return 204 (older API) or 200 with a run reference.
  // Do not log response contents, token, source data or private URLs.
  return 'dispatch_requested';
}

export default {
  async scheduled(_controller, env) {
    const outcome = await supervise(env);
    console.log('Nexus watchdog: ' + outcome);
  },
  async fetch() {
    // No publicly callable dispatch endpoint. Cron is the only executor.
    return new Response('Not found', {
      status:404, headers:{'Cache-Control':'no-store'},
    });
  },
};
