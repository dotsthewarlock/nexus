# Nexus RC1.4.7 — trustworthy commuter data

**Status:** RC1.4.7 camera playback initiation atop RC1.4.6 data integrity and conservative recommendation improvements; deployment is managed by GitHub Actions. The publishing workflow generates a fresh `data/live.json` from official sources.

## What's included

- Rebuilt mobile-first dashboard: preferred crossing, objective findings, compact alternatives, optional details, one primary route action.
- Persistent preferences for each travel direction, NEXUS, Home/Work, appearance, and recommendation sensitivity. Existing `nexus-prototype-v1` browser storage key is retained.
- One-trip crossing override does not overwrite saved preference.
- Deterministic `decision.js`: vetted operational notices, source and observation freshness, timezone-aware NEXUS published hours, conservative/balanced/information-only comparison. Conservative minimum difference is 20 minutes of **comparable inspection wait**; balanced minimum is 10 minutes. Neither is a full-trip saving estimate.
- Ambassador Bridge camera opens at **4×**, framed 50% toward the top and 20% toward the left of its permitted pan, with Fit / 2× / 3× / 4× controls, drag-to-pan and a compact 90dvh modal. Camera framing applies only to the cross-origin iframe rectangle; internal content is never accessed. Detroit–Windsor Tunnel offers **Watch Live** to load the operator's original Dacast iframe only after a tap, followed by the 15-second viewing cycle and **Continue watching**. The official DWT website is always linked. In-app playback remains browser/provider-dependent and requires Android Chrome validation.
- Expanded official data collection: CBP regular/NEXUS/Ready/FAST/commercial/pedestrian categories, lane counts and maximums; CBSA traveller and commercial waits; CBSA dedicated Canada-bound NEXUS schedules; Detroit–Windsor Tunnel operator lane counts and reported coarse travel-time category; optional Ontario 511 Windsor-Essex road advisories.
- Observation and source retrieval times remain distinct; stale operator data are suppressed. Wait observations aged 20–60 minutes remain visible as **STALE** but are excluded from recommendations; older or invalid reports are unavailable. Missing values are never converted to zero.
- GitHub Actions centrally collects data every **15 minutes** (minutes 07/22/37/52 UTC, best effort), publishes the shared static site, and archives each normalized snapshot as an Actions artifact for **30 days**. This is bounded archival, not permanent history storage or a forecast service.
- SVG icon sprites, responsive theme, no runtime JavaScript/CSS framework and no mandatory login.

## Project layout

| File | Purpose |
|---|---|
| `index.html` | Semantic dashboard and native modal markup |
| `styles.css` | Responsive colors, spacing, typography and interaction styles |
| `app.js` | Preference state, rendering, navigation and camera interactions |
| `decision.js` | Pure, testable source-aware crossing evaluation |
| `scripts/fetch_live.py` | Official source adapters and normalized `nexus-live-v2` JSON |
| `.github/workflows/publish.yml` | Scheduled collection, tests, snapshot archive, GitHub Pages deployment |
| `tests/` | Collector, decision logic and browser smoke tests |
| `previews/` | Synthetic-data layout QA only (never actual live conditions) |

## Test locally

```bash
python3 -m http.server 8000
# Visit http://localhost:8000/
```

The local placeholder displays an **unavailable** state until you run the collector with network access. For tests without network:

```bash
python3 -m unittest discover -s tests -v
node tests/decision.test.cjs
node tests/camera_rc147.test.cjs
python3 tests/smoke_rc14.py
python3 tests/ui_trust_rc146.py
```

The browser test uses synthetic, time-controlled fixture data and Chromium. It does not verify remote camera playback or external API uptime. It uses injected HTML/scripts rather than localhost navigation in restricted environments.

To fetch real data **from a network-enabled environment**:

```bash
python3 scripts/fetch_live.py --output data/live.json
```

If any feed is unavailable, the collector emits the other sources independently and marks the failed source with a status. It does not publish synthetic wait estimates.

## Optional Ontario 511 credential

Ontario 511 requires a developer account and key. Create an authorized key at `https://511on.ca/developers/doc` and set `ONTARIO_511_KEY` as a **GitHub Actions repository secret**. Do not put the key in HTML, query strings committed to the repo, or browser preferences.

The GitHub workflow reads the secret only in the server-side collection step. Without a key, Ontario 511 advisories are marked `not_configured` and the dashboard remains functional using CBP/CBSA data.

## Supported sources and limitations

| Source | Endpoint | Status |
|---|---|---|
| CBP | `https://bwt.cbp.gov/api/waittimes` | Parser implemented and fixture-tested; external GH-run verification required |
| CBSA waits | `https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv` | Parser implemented; official HTML fallback retained |
| CBSA NEXUS schedules | `https://www.cbsa-asfc.gc.ca/data/cbsa-offices-services-bureaux-asfc-en.json` | Structured parser implemented; schedules cannot establish live availability |
| DWT operator | `https://api.dwtunnel.com/api/traffic/conditionspublic` | Captured in user-supplied XHR; parser implemented; backend availability, permissions and update cadence remain to validate |
| Ontario 511 | `https://511on.ca/api/v2/get/event` | Optional developer-key integration, coarse Windsor–Essex vicinity filtering only |
| MDOT RIDE | `https://www.michigan.gov/mdot/travel/safety/efforts/its/its-data` | MiLogin for Business needed; linked only, no simulated API |
| Official cameras | Operator-site links and player iframes | Ambassador Bridge embedded; Tunnel opt-in Dacast experiment with external-site fallback. Playback may be blocked by the provider |

**Important constraints**

- A DWT `NexusLaneCount` is labeled as an **operator-listed lane count**, not an independently verified open inspection lane and not a NEXUS wait estimate.
- CBSA does not provide a separate Canada-bound NEXUS inspection wait in the current feed; it remains unknown. Published schedule windows only establish possible times, not that a lane is physically operating.
- Ontario 511 events are geographic vicinity context. The app does not claim a particular commute is obstructed without routing validation.
- MDOT RIDE data, additional operator notice APIs, a verified weather alert feed, holidays/school breaks and venue events are not silently fabricated; they require separate access and relevance validation.
- The Google Maps waypoint is a *preview*. Neither Android nor iOS crossing enforcement is claimed as reliable until tested in both directions at all crossings.
- Camera embedding/redistribution rights and playback must be checked before public production release. The official-source link is always retained.
- This build is not connected to a permanent time-series database or historical prediction engine. The 30-day Actions archive is temporary and only accessible to authorized workflow users.
- Static page hosting requires network connectivity for up-to-date snapshots. If the scheduled fetch fails, stale/unknown source states are displayed.

## Publication and known limitations

Deploy this release as one GitHub Pages commit via the existing workflow. GitHub Pages serves the latest available official snapshot. Testing the UI with synthetic data does **not** establish stream availability. The Dacast publisher may block embedding on Nexus even after a Watch Live tap. If so, use **Official camera page**; no proxying, domain spoofing, or referrer circumvention is implemented.

The 15-second viewing interval starts when Watch Live is tapped. This is a page-level viewing limit based on the operator's publicly visible page code, not a guarantee of any media-provider limit. It may interrupt playback if the player takes time to load.

RC1.4.6 fixes the formerly open decision-engine defects: day-type schedule applicability, routine-notice classification, future timestamps, and reading-age comparability. Refer to `RELEASE_NOTES_RC146.md`.

## RC1.4.5 camera changes

- Tunnel: opt-in Watch Live for each of the original three directional streams; camera switching unloads the prior player; 15-second Continue watching action; official camera-page fallback.
- Bridge: 4× default, upward framing offset 50% of available vertical pan, leftward framing offset 20% of available horizontal pan; Fit / 2× / 3× / 4×, pointer/keyboard panning, and responsive mobile modal.
- Tests: `python3 -m unittest discover -s tests`, `node tests/decision.test.cjs`, `node tests/camera_rc147.test.cjs`, and `python3 tests/smoke_rc14.py` locally. The GitHub Action runs the Python and Node tests before publishing.

## RC1.4.6 data trust and refresh rules

- **Current:** official observation ≤10 minutes old; **aging:** 10–20 minutes; **stale:** 20–60 minutes (numeric value visibly marked, not recommendation eligible); **unavailable:** >60 minutes, missing/invalid time. Snapshot/source age is independently enforced; an overdue collection never refreshes an old agency observation.
- **Recommendations:** only observations ≤10 minutes old with a ≤5-minute timestamp difference, same lane category, supported source status, no conflicting operational notice, and a meaningful policy threshold. The recommendation concerns *inspection waits*, not total-trip time.
- **Canada-bound NEXUS schedules:** evaluate the CBSA published lane schedules for local weekday/weekend and known 2026–27 Canadian/ON public-holiday dates, including overnight windows. Some observed holiday interpretations are not determined by the directory; these yield *unknown*. Even a scheduled window never confirms real-time lane operation. Government calendar references: [Canada.ca 2026 public holidays](https://www.canada.ca/en/revenue-agency/services/tax/public-holidays.html) and [Ontario 2026–27 school calendar holidays](https://www.ontario.ca/page/school-year-calendars).
- **Automatic collection:** centralized GitHub Actions every 15 minutes, staggered away from minute zero. Browser checks the one shared published JSON approximately every two minutes and on returning to the foreground after inactivity. Manual refresh checks the same JSON, with 30-second per-device cooldown; **no user interaction calls CBP/CBSA/DWT**.
- **Schedule validation:** the repository may show successful push-triggered builds before any schedule-triggered build is recorded. Diagnostics include the GitHub event trigger and run ID; do not describe the schedule as verified until actual `schedule` runs appear. GitHub scheduled workflows can be delayed/dropped or disabled after 60 days of public-repository inactivity.
- **Deferred:** permanent database/backend, direct user-triggered upstream requests, sub-five-minute guarantees, and RC1.5 three-crossing layout.

## RC1.4.7 Tunnel video initiation

Opening a Tunnel camera attempts to load the exact Dacast iframe used in RC1.4.5, without requiring the extra Watch Live tap. Camera-tab selection likewise starts the selected view. Android Chrome may still require tapping Play in the provider iframe. **Retry video** provides a real user-activated reload without rewriting the original Dacast URLs or bypassing restrictions. The original 15-second viewing interval, **Continue watching** and official-site fallback remain intact. Live Dacast playback requires manual device confirmation; local tests mock external video traffic. Bridge zoom, crossing data and RC1.4.6 trust logic are unchanged.
