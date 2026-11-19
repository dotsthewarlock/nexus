# Nexus RC1.4.8 — trustworthy commuter data

**Status:** RC1.4.8 trust-aware last-known reports and scheduled collection improvements, preserving RC1.4.7 cameras and RC1.4.6 conservative decision logic; deployment is managed by GitHub Actions. The publishing workflow generates a fresh `data/live.json` from official sources.

## What's included

- Rebuilt mobile-first dashboard: preferred crossing, objective findings, compact alternatives, optional details, one primary route action.
- Persistent preferences for each travel direction, NEXUS, Home/Work, appearance, and recommendation sensitivity. Existing `nexus-prototype-v1` browser storage key is retained.
- One-trip crossing override does not overwrite saved preference.
- Deterministic `decision.js`: vetted operational notices, source and observation freshness, timezone-aware NEXUS published hours, conservative/balanced/information-only comparison. Conservative minimum difference is 20 minutes of **comparable inspection wait**; balanced minimum is 10 minutes. Neither is a full-trip saving estimate.
- Ambassador Bridge camera opens at **4×**, framed 50% toward the top and 20% toward the left of its permitted pan, with Fit / 2× / 3× / 4× controls, drag-to-pan and a compact 90dvh modal. Camera framing applies only to the cross-origin iframe rectangle; internal content is never accessed. Detroit–Windsor Tunnel attempts to load the original Dacast iframe on modal open, with **Retry video** and a 15-second viewing cycle / **Continue watching**. The official DWT website is always linked. In-app playback remains browser/provider-dependent and requires Android Chrome validation.
- Expanded official data collection: CBP regular/NEXUS/Ready/FAST/commercial/pedestrian categories, lane counts and maximums; CBSA traveller and commercial waits; CBSA dedicated Canada-bound NEXUS schedules; Detroit–Windsor Tunnel operator lane counts and reported coarse travel-time category; optional Ontario 511 Windsor-Essex road advisories.
- Observation and source retrieval times remain distinct; stale operator data are suppressed. Wait observations aged 20–60 minutes remain visible as **STALE** and 60–120 minutes as **OLD REPORT**, never as current and never for recommendations; older observations are available only as timestamped history in expanded details. Missing values are never converted to zero.
- GitHub Actions centrally targets collection every **10 minutes** (minutes 03/13/23/33/43/53 UTC, best effort), publishes the shared static site, and archives each normalized snapshot as an Actions artifact for **30 days**. This is bounded archival, not permanent history storage or a forecast service.
- SVG icon sprites, responsive theme, no runtime JavaScript/CSS framework and no mandatory login.

## Project layout

| File | Purpose |
|---|---|
| `index.html` | Semantic dashboard and native modal markup |
| `styles.css` | Responsive colors, spacing, typography and interaction styles |
| `app.js` | Preference state, rendering, navigation and camera interactions |
| `decision.js` | Pure, testable source-aware crossing evaluation |
| `scripts/fetch_live.py` | Official source adapters, prior-report fallback, and normalized `nexus-live-v2` JSON |
| `scripts/report_health.py` | Actions summary of last successful fetch and observation ages |
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

Ontario 511 requires a developer account and key. Create an authorized key at `https://511on.ca/developers/doc` and set `ONTARIO_511_API_KEY` as a **GitHub Actions repository secret**. Do not put the key in HTML, query strings committed to the repo, or browser preferences.

The GitHub workflow reads the secret only in the server-side collection step. Without a key, Ontario 511 advisories are marked `not_configured` and the dashboard remains functional using CBP/CBSA data.

## Supported sources and limitations

| Source | Endpoint | Status |
|---|---|---|
| CBP | `https://bwt.cbp.gov/api/waittimes` | Parser implemented and fixture-tested; external GH-run verification required |
| CBSA waits | `https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv` | Parser implemented; official HTML fallback retained |
| CBSA NEXUS schedules | `https://www.cbsa-asfc.gc.ca/data/cbsa-offices-services-bureaux-asfc-en.json` | Structured parser implemented; schedules cannot establish live availability |
| DWT operator | `https://api.dwtunnel.com/api/traffic/conditionspublic` | Captured in user-supplied XHR; parser implemented; backend availability, permissions and update cadence remain to validate |
| Ontario 511 | Events (`/api/v2/get/event`), construction (`/api/v2/get/constructionprojects`), road conditions (`/api/v3/get/roadconditions`), alerts (`/api/v2/get/alerts`) at `https://511on.ca` | Four independently checked feeds; conservative Windsor–Essex relevance filtering |
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
- Tests: `python3 -m unittest discover -s tests`, `node tests/decision.test.cjs`, `node tests/camera_rc148.test.cjs`, and `python3 tests/smoke_rc14.py` locally. The GitHub Action runs the Python and Node tests before publishing.

## RC1.4.6 data trust and refresh rules

- **Current:** official observation ≤10 minutes old; **aging:** 10–20 minutes; **stale:** 20–60 minutes (numeric value visibly marked, not recommendation eligible); **old:** 60–120 minutes; **unavailable:** >120 minutes, missing/invalid time. Snapshot/source age is independently enforced; an overdue collection never refreshes an old agency observation.
- **Recommendations:** only observations ≤10 minutes old with a ≤5-minute timestamp difference, same lane category, supported source status, no conflicting operational notice, and a meaningful policy threshold. The recommendation concerns *inspection waits*, not total-trip time.
- **Canada-bound NEXUS schedules:** evaluate the CBSA published lane schedules for local weekday/weekend and known 2026–27 Canadian/ON public-holiday dates, including overnight windows. Some observed holiday interpretations are not determined by the directory; these yield *unknown*. Even a scheduled window never confirms real-time lane operation. Government calendar references: [Canada.ca 2026 public holidays](https://www.canada.ca/en/revenue-agency/services/tax/public-holidays.html) and [Ontario 2026–27 school calendar holidays](https://www.ontario.ca/page/school-year-calendars).
- **Automatic collection:** centralized GitHub Actions target every 10 minutes, staggered away from minute zero. Browser checks the one shared published JSON approximately every two minutes and on returning to the foreground after inactivity. Manual refresh checks the same JSON, with 30-second per-device cooldown; **no user interaction calls CBP/CBSA/DWT**.
- **Schedule validation:** at least one scheduled run was confirmed successful on November 18, 2026, but continued reliability and exact cadence are not guaranteed. Diagnostics include the trigger and run ID. GitHub scheduled workflows can be delayed/dropped or disabled after 60 days of public-repository inactivity.
- **Deferred:** permanent database/backend, direct user-triggered upstream requests, sub-five-minute guarantees, and RC1.5 three-crossing layout.

## RC1.4.7 Tunnel video initiation

Opening a Tunnel camera attempts to load the exact Dacast iframe used in RC1.4.5, without requiring the extra Watch Live tap. Camera-tab selection likewise starts the selected view. Android Chrome may still require tapping Play in the provider iframe. **Retry video** provides a real user-activated reload without rewriting the original Dacast URLs or bypassing restrictions. The original 15-second viewing interval, **Continue watching** and official-site fallback remain intact. Live Dacast playback requires manual device confirmation; local tests mock external video traffic. Bridge zoom, crossing data and RC1.4.6 trust logic are unchanged.


## RC1.4.8 — Trust-aware freshness and centralized collection

The site continues to fetch only one centrally published `data/live.json` snapshot; user refreshes never query official upstream APIs. GitHub Actions is scheduled every **10 minutes** (best effort, not a guaranteed SLA) with one publisher and no per-user upstream load. CBSA posted NEXUS schedules are reused for up to 24 hours when the prior verified snapshot is available, rather than fetched every cycle.

The scheduled collector fetches the previous published JSON **only to preserve provenance-qualified historical readings if a source fails**. Prior data is validated for schema and timestamps; previous fetch time and agency observation time are never replaced by collection time. A failed source is marked `error` and cached measurements are shown as `OLD REPORT`, excluded from switching recommendations. If the prior snapshot is unavailable, collection still proceeds independently; no caching state is required.

Observation ages: ≤10 min current; 10–20 aging; 20–60 stale; 60–120 old. Older observations are not shown as current waits, but last reported figures (with time/age) may be visible in expanded diagnostics. The snapshot itself may also be overdue. Only recent (≤10 min), comparable same-type measurements can support switching recommendations. Public API access does not guarantee regular updates or operator permission to republish.

The collector records status, the last successful retrieval time, previous-report usage, and run metadata. `scripts/report_health.py` prints source/observation ages into GitHub Actions job summaries. Check the GitHub Actions scheduled-run history to evaluate long-term reliability; the existing Pages publisher remains a single point of delay.

## Ontario 511 integration (feature branch)

The existing `.github/workflows/publish.yml` remains the **only** site publisher. Its scheduled or manually dispatched collector reads the `ONTARIO_511_API_KEY` Actions secret at runtime, performs **four** Ontario 511 calls per collection (below the documented 10 calls/60 seconds), and stages the sanitized output with the existing `data/live.json`. No frontend or committed file receives the API key. No user-triggered requests reach Ontario 511.

Documented sources: [Ontario 511 developer API](https://511on.ca/developers/doc), [events](https://511on.ca/help/endpoint/event), [construction](https://511on.ca/help/endpoint/constructionprojects), [road conditions](https://511on.ca/help/endpoint/roadconditions), [alerts](https://511on.ca/help/endpoint/alerts).

Public JSON (after a successful deployment): **https://dotsthewarlock.github.io/nexus/data/live.json**. Existing `nexus-live-v2` schema remains compatible. New fields within `supplemental` are `ontario511_construction`, `ontario511_road_conditions`, and `ontario511_alerts`; `ontario511_events` remains. Each has a corresponding `sources` key (the existing events key is `ontario511`). A source status of `ok` with `coverage: 0` means successfully retrieved but nothing matched the narrow local filter. `error`, `not_configured`, `not_collected`, and `retained_previous` are not assertions of clear roads. The official `LastUpdated` and other source times are retained as distinct ISO timestamps, and `retrieved_at` is the collection timestamp. Unavailable source timestamps remain null.

Regional matching is deliberately conservative: local coordinates or polyline evidence and a named corridor for traffic/construction; local descriptions or geometry for road conditions; explicit local road mentions for unlocated alerts. The following are **not** validated for exact route impact: corridor-specific access, border inspection delay, NEXUS operation, or U.S.-side road status. Construction recurrence schedules are not interpreted; the dashboard labels future reported projects as upcoming. A successful empty filtered feed is **not** a positive confirmation of unrestricted traffic.

### Verify

1. In GitHub → Settings → Secrets and variables → Actions, confirm secret **`ONTARIO_511_API_KEY`** exists (its value is not inspectable). No second secret is necessary.
2. GitHub → Actions → **Publish Nexus live snapshot** → **Run workflow** on `main` (after merge).
3. Confirm **Python collector tests**, **Collect official data**, **Report collection health**, and **Deploy Pages** pass. In the summary, review each of `ontario511`, `ontario511_construction`, `ontario511_road_conditions`, `ontario511_alerts`.
4. Open the published JSON above with a cache-busting query string, verify each source status is `ok`, inspect the four arrays and source timestamps. If a source is `error`, look for the **exception class** in JSON; error details and credential-bearing URLs are deliberately omitted from outputs.
5. Run `python3 -m unittest discover -s tests -v` and existing Node test commands locally. All test fixtures are synthetic. Never print the secret or invoke a `curl` command with its value.

An actual authenticated Ontario 511 response cannot be tested outside the Actions secret-bearing runner. Even with successful four-feed retrieval, the data only describes Ontario road context, not confirmed crossing access or border wait times.
