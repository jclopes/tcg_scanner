# TCG Scanner — Plan Overview

## Vision

A browser-based app for cataloging a personal collection of trading cards
across multiple TCGs. The user points a camera at a physical card; the app
identifies it and appends its identifier to a personal catalog (DB/file).
All processing is client-side — no server component.

## Non-goals

These are deliberately out of scope unless a future conversation adds them
as a new phase:

- A server/backend of any kind (auth, sync, storage) — everything runs in
  the browser.
- Multi-user or shared-collection features.
- Pricing, market value, or marketplace integration.
- Any card game type that isn't a standard-sized trading card (see
  physical card model in Phase 1).

## Phase roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Live capture & detection: camera feed → guide overlay → detect a card-shaped quad → output a flattened, cropped, correctly-oriented image of the card. No identification. | Planned — see [01-capture-and-detection.md](./01-capture-and-detection.md) |
| 2 | Card identification: match the flattened image (from Phase 1) to a specific card (game, set, collector number). | Not planned yet — deliberately deferred until Phase 1 is agreed |
| 3 | Catalog storage & export: persist identified cards to a DB/file, handle duplicates/quantities, export formats. | Not planned yet |
| 4+ | Anything else (search, filtering, collection value, multi-device sync, etc.) | Not planned — out of scope until explicitly requested |

Each phase gets its own plan document once the prior phase's plan is
agreed. Phase 1 is detailed enough to hand to an implementing agent now.

## Cross-cutting constraints (apply to every phase)

- **Client-only.** No server-side processing, ever, for the scanning
  pipeline itself.
- **Target devices/browsers:** mobile phone browsers (Chrome/Safari,
  `getUserMedia`) and laptop/desktop browsers with a webcam.
- **Stack:** TypeScript, no UI framework (vanilla DOM/Canvas/WebGL APIs).
- **CV primitives:** OpenCV.js (WASM) for edge detection, line fitting,
  and geometric transforms, rather than hand-rolled image processing.
- The previous Python/OpenCV CLI prototype in this repo (`src/`,
  `debug/`) is superseded by this plan and not reused; it was a throwaway
  test of the detection idea, not a foundation to build on.
