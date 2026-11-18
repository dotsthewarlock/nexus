# Nexus RC1.4.4 — commuter decision dashboard

**Status:** RC1.4.4 camera regression fix and mobile zoom improvements; deployment is managed by GitHub Actions. The publishing workflow generates a fresh `data/live.json` from official sources.

## What's included

- Rebuilt mobile-first dashboard: preferred crossing, objective findings, compact alternatives, optional details, one primary route action.
- Persistent preferences for each travel direction, NEXUS, Home/Work, appearance, and recommendation sensitivity. Existing `nexus-prototype-v1` browser storage key is retained.
- One-trip crossing override does not overwrite saved preference.
- Deterministic `decision.js`: official closure/notice checks, lane status, source freshness, conservative/balanced/information-only comparison. Conservative minimum difference is 20 minutes of **comparable inspection wait**; balanced minimum is 10 minutes. Neither is a full-trip saving estimate.
- Ambassador Bridge directional camera iframe opens at **3×**, with Fit/2×/3× controls, drag-to-pan, keyboard access and a compact ~90dvh modal. Camera framing is applied only to the cross-origin iframe rectangle; its internal player/image is never accessed. Detroit–Windsor Tunnel embeds use the **original RC1.4 Dacast URLs, iframe permissions and 15-second Continue watching cycle**, with the official DWT website as fallback. External playback is browser/provider-dependent and still requires Android Chrome validation. Closing or switching cameras unloads the prior iframe.
- Expanded official data collection: CBP regular/NEXUS/Ready/FAST/commercial/pedestrian categories, lane counts and maximums; CBSA traveller and commercial waits; CBSA dedicated Canada-bound NEXUS schedules; Detroit–Windsor Tunnel operator lane counts and reported coarse travel-time category; optional Ontario 511 Windsor-Essex road advisories.
- Observation and source retrieval times remain distinct; stale operator data are suppressed. Missing values are not converted to zero.
- GitHub Actions publishes a static site and archives each normalized snapshot as an Actions artifact for **30 days**. This is bounded archival, not permanent history storage or a forecast service.
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
python3 tests/smoke_rc14.py
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
| Official cameras | Operator-site links and player iframes | Ambassador Bridge embed attempted; Tunnel is an authorized external-site link because Dacast blocks third-party playback |

**Important constraints**

- A DWT `NexusLaneCount` is labeled as an **operator-listed lane count**, not an independently verified open inspection lane and not a NEXUS wait estimate.
- CBSA does not provide a separate Canada-bound NEXUS inspection wait in the current feed; it remains unknown. Published schedule windows only establish possible times, not that a lane is physically operating.
- Ontario 511 events are geographic vicinity context. The app does not claim a particular commute is obstructed without routing validation.
- MDOT RIDE data, additional operator notice APIs, a verified weather alert feed, holidays/school breaks and venue events are not silently fabricated; they require separate access and relevance validation.
- The Google Maps waypoint is a *preview*. Neither Android nor iOS crossing enforcement is claimed as reliable until tested in both directions at all crossings.
- Camera embedding/redistribution rights and playback must be checked before public production release. The official-source link is always retained.
- This build is not connected to a permanent time-series database or historical prediction engine. The 30-day Actions archive is temporary and only accessible to authorized workflow users.
- Static page hosting requires network connectivity for up-to-date snapshots. If the scheduled fetch fails, stale/unknown source states are displayed.

## Publication

RC1.4.4 restores RC1.4's original DWT in-app iframe implementation in response to reported successful playback on Android Chrome. This is a controlled compatibility rollback, **not a guarantee** of provider permission or functionality. If Dacast returns an embedding error, use the visible official camera page link; no proxying or referrer circumvention is attempted. The app-side 15-second interval matches RC1.4 and provides Continue watching. Validate actual video, image framing and routing on real devices. Earlier identified recommendation-engine issues (schedule day specificity, routine notices, and comparison-age consistency) are **not changed by this camera-only patch**.

## RC1.4.4 camera updates

- **Tunnel video rollback**: RC1.4's three original Dacast URLs, direction-specific camera tabs, iframe permissions, and 15-second Continue watching cycle are restored. Official site fallback remains available; video cannot be fully verified without the actual Android Chrome browser and provider access.
- **Bridge default 3×**: every opening and camera switch defaults to 3×. Fit / 2× / 3× explicit controls, tap-to-Fit/tap-to-3×, keyboard access, bounded drag-to-pan. The 4:3 iframe viewing surface is centered in a dark 90dvh modal with narrow margins, reducing the large white space caused by stretching the entire embedded operator document to full height.
- **Assets**: versioned CSS and JavaScript URLs prevent stale mixed releases. No dashboard or decision logic changes.

