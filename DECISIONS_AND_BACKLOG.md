# Nexus RC1 — Decision log and backlog

## RC1.2 - NEXUS-first changes
- Default NEXUS enabled for new users; saved preferences preserved.
- Always show regular and NEXUS waits and available CBP reported lane counts.
- Rank US-bound by valid NEXUS waits when enabled, falling back to regular if closed or missing without inventing zero waits. Canada-bound uses CBSA regular waits.
- Canada-bound published NEXUS schedules are distinct from live lane confirmation; US-bound schedule unavailable pending official verification.
- Optional browser geolocation: prompt only on button click, reuse previously granted permission on later visits; do not override URL/manual choice or guess near ambiguous border.

## Pending cleanup
- Validate geolocation heuristic on real devices in Windsor/Detroit suburbs; consider accurate local border polygon.
- Verify US-bound published NEXUS operating schedules and monitor changes to CBSA directory.
- Validate navigation waypoints for six routes before treating crossing selection as enforced.


## Durable decisions (implemented)

- One standalone HTML page with CSS/JS embedded. No framework or build step.
- Shared official snapshots via GitHub Actions, deployed to GitHub Pages every 15 minutes (best effort); do not poll agencies from every user's device.
- Static JSON contract `nexus-live-v1` separates source retrieval, source observation and snapshot generation.
- Fail closed on missing/unparseable values; no sample numbers and no fake NEXUS schedule.
- US-bound NEXUS is CBP *reported lane information*, not proof of physical lane availability; Canada-bound NEXUS unreported.
- Favourite crossing is prioritised unless officially closed, then ranked after available crossings. Standard passenger waits determine non-favourite ordering; not full trip times.
- User saved locations persist locally. URL origin/destination/direction/crossing/mode are session-specific and do not overwrite Home/Work.
- Routing uses Google Maps with a waypoint *preview* and explicit disclaimer; not validated crossing enforcement.

## Critical validation before public use

1. End-to-end GitHub Actions fetch from actual CBP and CBSA; real feed parsing, completeness and timestamps.
2. Real-world waypoint routing both directions × 3 crossings × Android/iOS; identify safe on-road waypoints.
3. Monitor GH Actions scheduling, source data publication frequency and stale thresholds. Adjust based on empirical observations.
4. Review license/data redistribution and bridge/tunnel operational restrictions.

## Cleanup / next iterations (not blockers for prototyping)

- Better handling of CSV schema changes after first live verification; add a captured anonymized schema fixture.
- Add small weather and local holiday chips once border data has proven reliable.
- Add direction detection by coarse location with a manual fallback; ensure geolocation permission requested only on demand.
- Add custom multiple favourite locations beyond Home and Work.
- Implement local sunrise/sunset appearance automation; currently system/light/dark.
- Refine mobile hierarchy and accessibility after actual usage; ensure warnings remain readable.
- Add typed status schema documentation and ingestion diagnostics at source-level.
- Consider a tiny Cloudflare Worker for fresher caching when GitHub Actions scheduling proves too slow/unreliable; avoid a server until justified.
- Measure true trip time separately from inspection wait, not extrapolated.
- Verify live NEXUS schedules/closures against operator/CBP sources before displaying scheduled hours.
- Consider offline last-good snapshot with visible age; do not mistake cached waits for current.
- Add local holiday, school calendar, road advisories and incident relevance filtering; later camera links.
- Plan deployment ownership, domain, privacy policy and basic health checks before wider public release.
