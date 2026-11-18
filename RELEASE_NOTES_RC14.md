# RC1.4 development release — verification summary

Date: 2026-11-18
Status: **Built locally; not deployed or live-validated**.

## Scope completed

1. Decision-first redesign: preferred crossing, objective condition headline, alternate crossing summary, expandable source and lane detail, simple route preview, camera modal.
2. New pure decision engine with tested closure and uncertainty cases, conservative 20-minute / balanced 10-minute **inspection-only** difference thresholds and information-only mode.
3. Data expansion: CBP Ready/commercial/FAST/pedestrian/max lanes and CBSA commercial; CBSA official NEXUS schedule extraction; DWT operator lane-count and coarse time-category extraction; optional Ontario 511 regional events.
4. Direction geofencing made conservative for inland locations; uncertain locations preserve manual choice. Manual direction and per-trip crossing selection remain in control.
5. Camera modals attempt immediate playback; three official DWT Dacast URLs plus operator-provided Ambassador views; 15-second DWT viewing interval; clean iframe unload.
6. Privacy-first locally retained destination and preference data; existing local storage key reused.
7. Deployment workflow includes Python/Node tests and rolling 30-day normalized snapshot artifacts.

## Automated validation completed

- Python `unittest`: **13 passed**, including legacy RC1.3 regression tests.
- Node decision tests: **21 scenario assertions passed**.
- Chromium local UI smoke: **passed** at 320px, 390px light/dark, and 1440px; includes direction changes, preference persistence within the session, alternate trip selection, camera iframe switching/unload, and route setup.
- Static syntax checks: `node --check app.js` and `node --check decision.js` passed.
- Preview PNGs were captured with **synthetic data only**.

## Not verified or intentionally deferred

- Live fetching from GitHub Actions (network disabled in the local build environment).
- DWT operator backend availability, rate limits, and external-display permission beyond the captured public request.
- Actual video autoplay on Nexus's origin and iOS/Android; Dacast account-side autoplay setting may be required.
- Ontario 511 Events API without a developer secret; MDOT RIDE without MiLogin for Business.
- Full-route travel ETA, map waypoint enforcement, precise per-crossing traffic incident impact.
- Weather alerts, event/holiday calendars, toll-aware ranking, permanent historical storage and predictive models.
- Comprehensive WCAG audit with assistive technology on physical devices.

## Release gate

Do not represent this package as deployed. Publishing requires explicit approval, a new commit, successful GitHub Actions runs and real-device cross-origin playback / routing checks.
