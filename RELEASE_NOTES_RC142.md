# RC1.4.2 — Tunnel camera access correction

Date: 2026-11-18

## Reason for patch

A user-provided Android Chrome screenshot showed the Tunnel Dacast player displaying "This content has been blocked on this website" inside the Nexus camera modal. Dacast documents publisher-controlled embed/referrer restrictions. RC1.3 linked to the official operator viewer rather than embedding DWT video.

## Changes

- Tunnel camera button now opens the official DWT camera website in a new tab on one user tap for either direction. Nexus no longer renders a known blocked Tunnel iframe or offers ineffective reload controls for it.
- The Tunnel button visibly indicates external viewing.
- Ambassador Bridge iframe camera viewer, zoom, pan, reset and keyboard access remain unchanged.
- Browser smoke tests verify both Tunnel directions and bridge camera regression behaviour.
- No extra dependencies or changes to the decision engine, official data collector or publishing pipeline.

## Limits

- DWT streams cannot be embedded within Nexus without the publisher allowing this origin; the operator controls its own Watch Live and viewing duration.
- The full real-device video experience on the operator website remains operator/browser-dependent.
- The previously noted recommendation engine correctness issues remain out of scope.
