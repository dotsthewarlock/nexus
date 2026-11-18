# RC1.4.3 — Bridge camera mobile interaction

- Ambassador Bridge camera modal uses the full available mobile viewport rather than a 16:9 landscape slot.
- A prominent Zoom 2× / Reset zoom button accompanies tap-to-zoom and drag-to-pan, and closes cleanly.
- Camera iframe remains hosted by the official bridge operator; no attempt to access cross-origin content.
- Styles and scripts are release-versioned in HTML to avoid cached old zoom behavior.
- Tunnel camera opens the operator's own site directly, as in RC1.4.2.
- The comparison and NEXUS recommendation engine is unchanged; known correctness gaps remain in the backlog.
- Real-device and external image sizing require user verification because operator iframe content is cross-origin.
