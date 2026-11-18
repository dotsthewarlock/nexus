# Nexus RC1.4.5 — Camera usability and controlled playback experiment

Date: 2026-11-18

- Tunnel: Dacast player loads **only when Watch Live is tapped**, matching the operator's opt-in interaction. Three camera URLs remain unchanged. 15-second viewing interval and Continue watching preserved, with an explicit official-site fallback. Third-party playback **not yet verified** on Android Chrome; domain-based blocks may persist. No workaround or proxy.
- Ambassador Bridge: default 4× on each open/switch; framing offset upward by 50% and leftward by 20% of the permitted pan travel, with bounds. Fit / 2× / 3× / 4×, swipe-to-pan and keyboard controls remain available.
- Frontend assets cache-busted with `rc145` identifiers. Dashboard, collector and recommendation logic unchanged.
- Tests cover manual iframe gating, camera changes, 15-second continuation, zoom/pan default positions, 320/390 desktop layouts.
