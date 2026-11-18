# Nexus — Release Candidate 01

One-page static HTML commuter dashboard, with CBP/CBSA official snapshots collected and deployed by a GitHub Actions workflow. No account, database, API key, paid mapping API, or backend server is required. **Not yet a production-validated border routing app.**

## Fastest deployment (GitHub Pages)

1. Create a new **public** GitHub repository, e.g. `nexus-commuter`.
2. Upload the contents of this folder to the repository root, including the hidden `.github/workflows/publish.yml` file (easiest: Git push; GitHub's file uploader can also accept the folders, but check hidden paths).
3. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
4. In **Actions → Publish Nexus RC1 live snapshot**, run **Run workflow** once, or push an update to `main`. The workflow fetches official CBP/CBSA data, runs unit tests, builds `data/live.json`, and publishes the HTML page and snapshot together.
5. Open your published Pages URL. Check the source diagnostics in Settings. Every 15 minutes the workflow attempts to publish a new snapshot. The live source observation time is distinct from the snapshot generation time.

**No other services required.** GitHub scheduled jobs can be delayed, so the app checks reading age and hides stale values automatically. Scheduled workflows in inactive public repositories can be disabled after 60 days; verify Actions health if data goes stale. GitHub Pages must be configured to build through GitHub Actions (not branch publishing) so each scheduled run publishes the new snapshot.

If the workflow fails, inspect its log. This sandbox has no external network access for Python, so real end-to-end remote fetch cannot be verified until the Actions workflow runs on GitHub.

## Features

- All three crossings in both directions, per-direction selected crossing and favourite.
- Official **CBP JSON** US-bound passenger/standard and NEXUS lane reports. CBP closures, lane open counts, construction notices where present. Separate observation time.
- Official **CBSA CSV** Canada-bound traveller wait reports; fall back to CBSA's official HTML crossing table if the CSV cannot be parsed. CBSA does **not** provide a Canada-bound NEXUS wait in these feeds.
- Conservative ranking: favourites first; otherwise valid reported standard inspection waits; unknown waits sorted after valid waits. Not a full-trip recommendation.
- Readings older than 90 minutes labelled aging; older than 150 minutes hidden as stale; missing source timestamps shown as unavailable. Also reject old generated snapshots.
- Home/Work saved locally, editable one-off origin and destination, shareable URL parameters, Google Maps preview links using a crossing waypoint. **The external map can ignore the waypoint and is not guaranteed to respect the crossing.**
- Manual Refresh and automatic client refresh every two minutes (the static snapshot changes only when GitHub Actions deploys a newer one).
- No simulated wait numbers in the published application.

## Share links

```text
https://YOURNAME.github.io/nexus-commuter/?origin=Windsor%2C%20ON&destination=Troy%2C%20MI&direction=us&crossing=gordie&mode=nexus
```

Supported parameters: `origin` (optional; omitted means current position inside Google Maps), `destination`, `direction=us|ca`, `crossing=ambassador|tunnel|gordie` (also `ghib`), `mode=nexus|standard`. Parameters override the local interface *for that visit* and do not replace the saved Home/Work locations.

## Source disclosure

- CBP: https://bwt.cbp.gov/api/waittimes
- CBSA: https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv (HTML fallback: https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html)
- CBSA dataset: https://open.canada.ca/data/en/dataset/d4a716f5-a2fc-4c3c-88ed-451fe05900e4 — Open Government Licence – Canada.
- These are **border inspection wait estimates**, excluding approach-road congestion, tolls and full-trip duration.
- Official published schedules are not live confirmation of NEXUS lane operation.

## Tests

```sh
python3 -m unittest discover -s tests -v
python3 scripts/fetch_live.py --output data/live.json
python3 -m http.server 8000
# Visit http://localhost:8000
```

Opening `index.html` through `file://` blocks access to adjacent JSON in many browsers. Use a web server or GitHub Pages.

## Critical release gates before relying on RC1 while driving

1. Confirm the GitHub Actions **first live run** successfully covers all three CBP and all three CBSA crossings. The CBSA live CSV format cannot be directly tested in this sandbox; the parser fallback uses the official HTML table.
2. Inspect actual age display in both directions, including missing/stale and genuinely closed lane states.
3. Verify Google Maps routes for **each crossing in both directions** on Android and iOS. Until then route preview requires confirmation.
4. Verify applicable source terms, refresh volume, and attribution prior to public launch.

## Deferred cleanup / technical debt

See `DECISIONS_AND_BACKLOG.md`.
