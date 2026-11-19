# Nexus RC1.4.7 — Tunnel video auto-load attempt

Scope: narrow, source-preserving camera patch atop RC1.4.6. No collector, decision-engine, or Bridge changes.

- On opening the Detroit–Windsor Tunnel camera modal, attempt loading the same Dacast iframe that formerly loaded after tapping Watch Live. This is a player **load attempt**, not a promise of autoplay.
- Auto-load on changing Tunnel camera tabs.
- Show a persistent **Retry video** control that reinitializes the original iframe using a real user gesture, including after provider/browser autoplay denial.
- Retain the original 15-second app-side viewing cycle and **Continue watching**; the cycle starts on the iframe load attempt, not guaranteed media playback.
- Preserve operator links, Dacast URLs, Bridge cameras and all RC1.4.6 conservative-data behavior.
- Increment CSS and JS asset cache identifiers to rc147; update tests to assert both auto-load and manual recovery.

Device QA required: Chrome Android and iOS Safari playback, including provider-side embed restrictions. A cross-origin iframe cannot reliably report actual playback to Nexus.
