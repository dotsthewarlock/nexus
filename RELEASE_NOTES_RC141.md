# RC1.4.1 — Camera interaction hotfix

Date: 2026-11-18

## Scope

- Ambassador Bridge directional camera: tap to zoom to 2x, drag/swipe to pan within image bounds, tap to reset, keyboard enter/space and arrow-key controls. Camera zoom resets on close, switch, or refresh. Cross-origin iframe content is never accessed.
- Detroit–Windsor Tunnel: retain the three publisher Dacast player URLs, load player immediately from camera tap, remove Nexus's unconditional 15-second iframe teardown, add Reload video. Official operator camera link remains accessible.
- Add browser regression coverage for zoom, pan, reset, tunnel player non-interference and reload. No extra libraries.

## Validation and limits

- Playwright/Chromium UI smoke uses synthetic local data and cannot demonstrate actual Dacast streaming or operator camera picture content.
- Dacast publisher autoplay configuration, cross-origin permissions, mobile browser policy, and operator viewing conditions remain outside Nexus's control. The app does not disable provider controls.
- Existing RC1.4 recommendation engine and live-data adapters are unchanged. Reassessed decision-logic defects require a separate follow-up patch.
