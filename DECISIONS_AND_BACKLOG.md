# RC1.3 decision / risk update

## Confirmed for this release

- External `styles.css`, single file and semantic tokens; future subdivision possible, not yet warranted.
- CBP-inspired navy/blue and restrained CBSA-inspired red with accessible dark theme, without agency logos or implied government endorsement.
- Native modal with official camera links in all six direction/crossing combinations.
- Ambassador Bridge opt-in `iframe` preview uses the iframe URL found on the operator's directional pages; no preview loaded until user action.
- Tunnel and Gordie Howe preview deliberately not embedded without a tested/authorized official feed.
- No GitHub changes during build/review. Separate approval for publish.
- Fixed RC1.2 location mapping bug (physical country vs travel direction were previously the same instead of opposite).

## Open validation gates

- Cross-origin camera embed restrictions and licensing need actual browser/provider validation.
- Check mobile light/dark contrast and modal accessibility.
- Recheck Canada-bound published NEXUS schedules and US-bound schedule availability before representing them as exhaustive.

---

# Nexus RC1 — Decision log and backlog

## Durable decisions (implemented)

- RC1.2: NEXUS enabled for new installations (preserves saved user preference); regular/NEXUS waits always visible.
- RC1.2: US-bound NEXUS observations determine ranking for NEXUS users. Closed NEXUS lanes use a clearly disclosed regular-lane fallback; missing NEXUS never counts as a zero-minute lane. Canada-bound ranking continues to use CBSA regular waits.
- RC1.2: Official CBP lane-open counts displayed as reported. CBSA lane counts and separate Canada-bound NEXUS waits intentionally unavailable.
- RC1.2: Published Canada-bound CBSA NEXUS schedules shown separately from live lane status; US-bound schedule remains unverified.
- RC1.2: Direction location detection is opt-in once, then automatic only with already-granted permission. Approximate local coordinates; ambiguous/out-of-area positions leave manual preference unchanged. Shared URL direction overrides automatic detection.


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
- Improve geolocation border classification using a validated border polygon and test in Windsor, Detroit and suburbs; current implementation uses conservative local heuristics.
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

## RC1.1 changes (local package; not pushed to GitHub)

- Default cards now show regular and NEXUS waits side by side, irrespective of the user's NEXUS preference.
- CBP-reported lane counts shown for US-bound regular and NEXUS where available and fresh; no counts inferred from published schedules.
- CBSA does not provide separate CA-bound NEXUS waits or live lane counts in the used feed. Explicit unavailable messaging is shown.
- CA-bound published NEXUS schedule details are included as a provisional transcription of the CBSA office directory. Re-verify before public operational reliance; schedule is not proof lanes are open.
- US-bound separate published NEXUS hours are not verified and not guessed.
- Future: automate schedule extraction and holiday-aware filtering, validate hours for each direction, test accessibility, and decide whether to retain NEXUS user preference for ranking.
