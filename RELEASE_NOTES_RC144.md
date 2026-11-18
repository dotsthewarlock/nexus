# Nexus RC1.4.4 — camera regression release

Date: 2026-11-18

## Changes

1. Restored **RC1.4's exact Detroit–Windsor Tunnel player URLs** for Windsor inspection (Canada → USA), Detroit inspection and Randolph Street (USA → Canada). Original iframe playback permissions and the app-side 15-second viewing interval with **Continue watching** are restored. Official operator page remains available as a fallback. The camera viewer is opened only after a tap; closing or changing camera unloads the old iframe.
2. Ambassador Bridge mobile camera opens at **3× by default**; Fit, 2× and 3× buttons; drag-to-pan, keyboard arrows, tap-to-Fit; resets on close/switch. Replaced the full-height iframe (which showed large blank sections) with a centered 4:3 cross-origin camera viewport. Modal uses approximately 90% of the mobile viewport height and small side margins.
3. Versioned frontend assets as `rc144` to mitigate cached JS/CSS behavior mismatches.
4. Expanded local mobile Chromium smoke checks for the DWT 15-second cycle, direction-specific cameras, bridge 3×/Fit/2×, pan, and 320px/390px responsive layout.

## Limits and follow-up

- Real Dacast autoplay/playback cannot be verified in the local test environment. In-app playback is **not guaranteed**: the publisher may block cross-origin access, in which case the official camera page should be used. No domain-spoofing, stream proxy, or other restriction circumvention.
- The bridge operator controls the embedded image size and contents. Viewport crop is CSS-based; framing should be checked on real Android Chrome, in both directions.
- RC1.4.x decision-engine correctness issues identified in the audit are **not addressed** by this camera-only release.
- Source feed collection remains centralized; no new upstream requests are performed from the camera frontend.
