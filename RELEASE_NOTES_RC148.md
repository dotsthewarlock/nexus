# Nexus RC1.4.8 — Preserve trustworthy reports and optimize collection

## Changes

- Official inspection readings aged 20–60 minutes display **STALE**; 60–120 minutes display **OLD REPORT**. Older observations are omitted from headline metrics, with an aged historical reference (up to 24h) allowed in details.
- Retrieved and observed timestamps remain separate, with publication age also visible. Recommendations still require ≤10-minute matched observations within a ≤5-minute window.
- On upstream failure, a validated previous snapshot can preserve a reading for at most 120 minutes. Its last successful source retrieval and original observation timestamps are retained and it is **never** eligible for recommendations. Closed-lane reports never silently persist as live closures.
- GitHub Actions collector targets 10-minute intervals at :03/:13/:23/:33/:43/:53, still publishes one static Pages snapshot. Client-side refresh checks only cached JSON.
- CBSA published NEXUS schedule is reused for up to 24h from a validated prior snapshot; no routine every-10-minute schedule request.
- Actions job summary prints age ranges and source failures without failing the whole site on partial feed degradation.
- Tunnel video/camera and Ambassador Bridge 4× viewer unchanged. No new backend, database, or direct per-user upstream polling.

## Caveats

- Scheduled GitHub Actions runs and Pages deployment are best-effort, not a 10-minute delivery SLA.
- Older official values are historical context only; *zero minutes reported* is not proof of zero current wait.
- Last-known fallback requires the previous published JSON to be retrievable. If unavailable, this fails safe and the source is unavailable rather than fabricated.
- Ontario 511 still requires a configured official developer key; no unauthorized scraping or cross-site video workarounds added.
