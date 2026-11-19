# Nexus RC1.4.6 — Data integrity and conservative recommendations

**Release intent:** Correctness and transparent freshness take precedence over apparently optimistic wait estimates. Built on RC1.4.5; camera, route, destination, and theme behavior intentionally preserved.

## Changes

1. Reject implausible future observation/snapshot timestamps (2-minute tolerance for minor clock skew). Never turn missing data into 0 minutes.
2. Separate observation status: **current** (0–10 minutes), **aging** (10–20), **stale** (20–60, numeric value marked STALE), and **unavailable** (over 60 minutes, unknown time, or invalid record). Also flag an overdue collector snapshot independently of individual source readings.
3. Restrict crossing-switch suggestions to fresh, comparable inspection measurements from matching lane types: source/snapshot and lane readings at most 10 minutes old, observation times no more than 5 minutes apart, difference at least 20 minutes (Conservative) or 10 minutes (Balanced). No full-trip time savings are asserted. Regular-lane readings are not silently substituted for a requested NEXUS comparison.
4. Classify routine CBP Ready Lane scheduling notices as informational so they do not mask actual inspections or block comparisons. Explicit closures/incidents/operational notices remain visible and suppress automated comparative advice.
5. Evaluate CBSA's Canada-bound *published* NEXUS hours by Windsor local weekday/weekend/holiday and overnight windows. A bounded 2026–2027 holiday calendar is cross-checked against Canadian public-holiday dates; uncertain observed holidays and uncovered years return **unknown** rather than a definitive answer. These schedules **never** establish live lane availability.
6. Preserve the centralized collector. GitHub Actions schedule stays every **15 minutes**, now staggered at minutes 07, 22, 37, 52 to avoid minute 0 contention. No public request can trigger additional agency scraping. Snapshot diagnostics display run trigger and run ID; scheduled-run reliability remains to be verified from actual `schedule` runs.
7. Browser Refresh checks only the shared published JSON. Thirty-second per-device manual cooldown, existing two-minute background check, resumption check after inactivity, and refusal to replace a newer snapshot with an older CDN response.
8. Data status includes count of current/aging reports, collector age, and source age. Clearly labeled historical numeric readings remain viewable without becoming recommendation inputs.

## Validation

- `python -m unittest discover -s tests -v` (official source parsers)
- `node tests/decision.test.cjs` (54+ trust scenarios and schedule edge cases)
- `node tests/camera_rc145.test.cjs` (prior camera regression)
- `python tests/smoke_rc14.py` and `python tests/ui_trust_rc146.py` (local Chromium, synthetic data)
- `node --check app.js` and `node --check decision.js`

## Limitations / release follow-up

- GitHub scheduled workflow trigger **has not yet been observed**; a successful `push` build does not prove future cron collection. Verify scheduled events independently. GitHub may delay or drop scheduled runs and disable schedules on inactive public repositories.
- The 15-minute collection cadence does **not** imply official readings are 15 minutes old. Agency observation times can be much older, particularly CBP. More frequent polling would not fix unchanged agency observations.
- Canadian public-holiday calendars are a conservative aid, not confirmation of CBSA's precise interpretation of all published `Holidays` schedules or live NEXUS availability.
- Road approach times, total-trip advantage, mobile camera provider permissions, operator data licensing, and Android/iOS route enforcement remain unverified.
- No new backend, polling interval increase, destination overhaul, or camera autoplay changes in this release.
