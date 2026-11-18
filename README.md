# Nexus RC1.3 — published release

A static Windsor–Detroit commuter dashboard. Includes **existing RC1.2 live CBP/CBSA data integration** and NEXUS-first behavior, refreshed civic theme, single external `styles.css`, and official camera modal.

## Scope delivered

- Blue/navy/red **government-inspired, non-official** styling with tokenized light and dark modes.
- One stylesheet (`styles.css`) organized into semantic design tokens and functional components. No CSS framework or build step.
- Every crossing shows regular / NEXUS reported waits and available lane counts. Canada-bound gaps remain explicit.
- NEXUS preference ON by default for new users; local saved settings retained.
- NEXUS-first US-bound wait sorting with explicit regular fallback.
- Optional location direction detection correctly maps current country to *opposite* travel destination; no automatic permission prompt.
- Native camera `<dialog>` on all three crossing cards. Six direction-aware official links:
  - Ambassador Bridge: operator pages, and **user-initiated** iframe preview using operator's own embedded camera URLs. Whether third-party embedding is permitted and operational requires testing after deployment; official page link always available.
  - Detroit–Windsor Tunnel: operator home live camera views, no unverified iframe stream.
  - Gordie Howe: government road approach maps (Ontario 511 and MDOT). These are **not** verified bridge/plaza cameras.
- Closing a camera modal removes the iframe URL to stop network/media playback.
- GitHub Pages workflow stages `styles.css` alongside HTML and freshly collected JSON.

## Live-data policy

- Official CBP: `https://bwt.cbp.gov/api/waittimes`
- Official CBSA: `https://www.cbsa-asfc.gc.ca/bwt-taf/bwt-eng.csv` (fallback official HTML)
- Do not equate missing readings with zero wait. Published NEXUS hours do not guarantee actual lanes are open.
- Wait times are inspection estimates only; approach traffic and total trip times are separate.

## Run locally (no live release)

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

When opened as `file://`, browser security may block `./data/live.json`. `index.html` should be served over HTTP(S) to verify the live snapshot.

## Verify

```bash
python3 -m unittest discover -s tests -v
python3 tests/smoke_rc13.py  # optional: Chromium and Playwright installed
```

The script `scripts/fetch_live.py` is unchanged from RC1.2. Only the GitHub Action run can verify outgoing feeds and the final deployed `data/live.json`.

## Deployment

The GitHub Actions workflow deploys `index.html`, `styles.css`, and the newly collected `data/live.json`. Do not commit locally generated snapshots as authoritative live readings.

## Pending validation / limitations

1. Test Ambassador camera iframe on Android/iOS; the provider may reject third-party framing. External links must always be visible.
2. Ask the tunnel operator for an approved embeddable player URL before attempting in-app video.
3. Substitute direct official Gordie Howe cameras only if operator publishes public feeds and confirms access rights.
4. Validate current hardcoded Canada-bound CBSA NEXUS hours against changing published schedules and holiday rules.
5. Verify Android/iOS maps routing and border-side geolocation in real world; automatic location is approximate and optional.
6. Test CSS contrast and layout at mobile sizes after deployment.
