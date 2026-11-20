# M2c proposal — independent Nexus publication watchdog

**Status:** Proposed, **not deployed or activated**. This is an implementation candidate, not approval of infrastructure.  
**Verified:** November 19, 2026.  
**Current architecture:** Python collector, GitHub Actions, GitHub Pages; retain all.

## Evidence and scope

Existing GitHub publishing cron targets every 10 minutes at 3,13,23,33,43,53 UTC but [M2 issue #19](https://github.com/dotsthewarlock/nexus/issues/19) documents multi-hour gaps and a stable-window audit with four expected slots and zero schedule-triggered starts. Agency requests have succeeded during actual runs. A recent fetch does not prove a recent agency observation.

**Candidate:** One separate Cloudflare Worker with a Cron Trigger. It checks published Nexus snapshot age and, only when publication is overdue and GitHub is not already publishing, requests the existing workflow_dispatch event. This does not move the site, collector, credentials or data.

## Designed trigger

1. Cloudflare cron: **8,18,28,38,48,58 * * * *** (UTC), five minutes after GitHub's native schedule.
2. Fetch the publicly served Pages data/live.json with a cache-busting query. A valid nexus-live-v2 snapshot generated within **12 minutes** stops further action.
3. Otherwise fetch the existing GitHub publishing workflow run history. If a run is queued, waiting, in progress, or began within **8 minutes**, skip to avoid duplicate jobs.
4. If no suitable run exists, POST the JSON body {"ref":"main"} to the existing GitHub publishing workflow dispatch API.
5. Record success or failure in Cloudflare cron execution history, without logging credentials.

The thresholds are **provisional operational heuristics**, not official agency SLAs. Cloudflare cron is also best-effort, not guaranteed. A stale/publicly unreachable snapshot can trigger recovery, but no scheduler can force fresh underlying CBP/CBSA observations.

## Secret and security

**Explicit owner action is required before activation.** Create a GitHub fine-grained personal access token restricted to **dotsthewarlock/nexus only**, with repository **Actions: Read and write** permission. This permission is required by the [official workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event). Prefer an expiration and rotation plan.

Store the token as Cloudflare Worker **encrypted secret GITHUB_ACTIONS_TOKEN**. Never put its value into chat, repository source, logs, Pages assets, public JSON or a URL. The Worker has **no public dispatch endpoint**; all incoming HTTP requests get a 404.

The connected Cloudflare account currently has three Workers, no configured cron triggers, and no Nexus watchdog to overwrite. Activation should create a new, separately named Worker only.

## Activation sequence (requires approval)

1. Review ops/cloudflare/nexus-publish-watchdog.mjs and run the offline fixtures: node tests/watchdog_m2c.test.cjs.
2. Provision a new Cloudflare Worker called nexus-publish-watchdog from the reviewed module; leave GitHub Pages hosting unchanged.
3. Add the encrypted GITHUB_ACTIONS_TOKEN Worker secret privately **before** enabling the cron trigger.
4. Set cron exactly to 8,18,28,38,48,58 * * * * (UTC). No public routes required.
5. Verify one overdue-snapshot test yields an actual workflow_dispatch run in GitHub Actions, and a recent snapshot/active publisher yields no duplicate.
6. Review 24h logs and resulting publication cadence, then assess overlap/cost. Initially keep GitHub cron as redundant fallback.

**Do not enable cron before the secret is installed.** No keys are read or published in the frontend.

## Cost and failure modes

A 10-minute trigger is about **144 scheduled calls per day**. Cloudflare documents Free plan capacity of 100,000 requests/day and up to five cron triggers per account, subject to plan eligibility and limits. This Worker uses one public Pages request and up to two GitHub API requests per invocation. GitHub Actions minutes, credential rotation and Cloudflare trigger reliability are the main operational tradeoffs. If the GitHub API is unavailable, the Worker reports failure; it does not report a false success.

A status-only external uptime monitor needs no GitHub credential, but can only **detect** stale publication, not recover it. This design provides a narrow authenticated recovery trigger, but it does require approval of the added security dependency.

## Documentation

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Cloudflare encrypted Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [GitHub workflow dispatch API and fine-grained token permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)

**Recommendation (Proposed):** Approve a single Cloudflare Cron watchdog as a backup to existing GitHub scheduled collection. Do not migrate the current collector/host. The current code proposal alone does not activate scheduling.
