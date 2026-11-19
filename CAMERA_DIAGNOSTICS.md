# DWT camera diagnostics — isolated test page

The main Nexus camera is unchanged. Open:

https://dotsthewarlock.github.io/nexus/camera-diagnostics.html

## Goal

Test whether the provider's player rejects embedding on the Nexus origin, versus failing due to Nexus's iframe lifecycle, timing, or permissions. Do **not** treat an iframe `load` event as proof that a Dacast stream plays.

## How to test

1. On Android Chrome, choose one camera (start with Windsor inspection / Canada → USA).
2. Tap **A · Operator-style iframe**, and attempt Play inside the frame. Select what actually occurred in result A.
3. Tap **B · Nexus-style iframe**, attempt Play, then record result B. The previous iframe is unloaded before this test.
4. Tap **C · Open Dacast directly**; record whether playback works outside the Nexus frame.
5. Tap **D · Official DWT website**; find the same camera and record the result.
6. Tap **Copy results** and paste the report into the project conversation. No results are uploaded automatically.

Repeat with the USA → Canada / Detroit inspection camera if the behavior is unclear. If all tests are blocked, do not attempt to bypass the operator's restrictions.

## Interpretation

| Result | Likely next step |
|---|---|
| A works and B blocked | Inspect Nexus iframe permissions, referrer policy, DOM insertion, and lifecycle. |
| A and B blocked, C works, D works | Investigate provider's allowed embed domains and iframe security policy; request permission from DWT/Dacast if required. |
| A and B blocked, C blocked, D works | Further investigate player allowed-origin/referrer configuration; avoid unsupported code workarounds. |
| All fail | Verify stream availability and browser/network conditions independently. |

The tests are diagnostic, not proof of embedding entitlement. The exact browser Network/Console response (especially 403, CSP, frame-ancestors, or Dacast-specific error) can help confirm the cause. On Android, simply recording the exact onscreen error and test result is sufficient to start.

## Isolation and privacy

- All streams use the same exact Dacast IDs already present in `app.js`.
- No border APIs are called, no user account is needed, no camera is proxied or downloaded, and no video is captured.
- No autoplay attempt, 15-second cutoff, or cross-origin DOM manipulation is involved.
- Camera playback and result interpretation require manual observation; the page cannot inspect the cross-origin player's internal errors.
- The page is unlisted in Nexus's main UI but publicly accessible by URL. It is not an access-controlled secret.
