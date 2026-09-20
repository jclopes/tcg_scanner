# TCG Scanner

A browser-only trading card scanner: point a camera at a physical
trading card, detect its edges, and produce a flattened, cropped,
upright image of it. Everything runs client-side — no server component.

This is Phase 1 of a larger project (camera capture & detection only;
card *identification* and *cataloging* are future phases). See
[docs/plan/](./docs/plan/) for the full design — start with
[00-overview.md](./docs/plan/00-overview.md).

## Requirements

- Node.js 20+ and npm.
- A Chromium- or WebKit-based browser with camera support (Chrome/Edge,
  Safari) for actually using the scan flow. Firefox lacks some of the
  APIs this project relies on (`requestVideoFrameCallback`,
  `ImageCapture`) — it'll fall back gracefully where documented, but
  hasn't been verified.
- A camera (phone camera or a laptop/desktop webcam) to exercise the
  live scan flow — the app still loads and builds without one, but the
  Scan button will show a "no camera" error.

## Getting started

```sh
npm install
npm run dev
```

Opens a dev server (default `http://localhost:5173`). Camera access
requires a "secure context" — `localhost` counts as one automatically
in every browser, so this works out of the box on the same machine.

### Testing on a phone (or any device other than the dev machine)

Browsers only allow camera access on HTTPS or `localhost` — a plain
`http://<your-lan-ip>:5173` URL from another device will have its
camera access silently blocked. To scan from a phone on the same
network, either:

- Run `npm run dev -- --host` and use one of Vite's HTTPS options (a
  mkcert-generated local certificate is the simplest — see
  [Vite's HTTPS docs](https://vite.dev/config/server-options.html#server-https)),
  or
- Use a tunnel that terminates HTTPS for you (e.g. `ngrok`, Cloudflare
  Tunnel) pointed at the dev server.

## Testing

```sh
npm test
```

Runs the Vitest suite once. Only `src/core` (the pure functional core —
geometry, edge/quad detection math, orientation) has unit tests, by
design: it's the project's business logic, and the only part that's
meaningfully testable without a real browser/camera. `src/shell`
(camera, DOM, UI state) and `src/workers` (Web Worker message-passing)
are deliberately untested — they're glue code that Vitest can't
realistically exercise (`getUserMedia`, live video frames, real Web
Workers), and the project's convention is tests for business logic
only, not for DOM/browser-API glue.

Use `npm test -- --watch` for watch mode.

## Building

```sh
npm run build
```

Runs `tsc --noEmit` (type-check, strict mode) followed by `vite build`,
producing a static production bundle in `dist/`. The build currently
prints a chunk-size warning — this is from OpenCV.js's WASM bundle
(~15 MB unminified, ~4 MB gzipped), which is expected and not a
regression; see
[02-project-structure.md](./docs/plan/02-project-structure.md) for why.

## Project structure

```
src/
  core/      Functional core — pure, browser-free, unit-tested functions
             (guide geometry, edge/quad detection math, perspective
             transform, orientation rotation, pixel-region extraction).
             No DOM, no camera, no side effects.
  workers/   The edge-detection Web Worker pool — parallelizes the
             core's fitEdgeLine across 4 dedicated workers, one per
             guide edge. Message-passing/lifecycle glue, not tested.
  shell/     The imperative shell — camera acquisition, guide overlay
             rendering, the Scan button's state machine, the live
             frame-sampling loop, and final capture. All DOM/browser-API
             code lives here and calls into core + workers. Not tested.
index.html   Page markup + the app's (minimal, hand-written) CSS.
src/main.ts  Entry point: waits for OpenCV.js, hands off to shell/app.ts.
docs/plan/   Design docs — the phased plan, and an as-built reference
             for each stage (project structure, functional core,
             worker pool, imperative shell).
```

This split (functional core vs. imperative shell) is a deliberate,
load-bearing convention for this project, not just a folder naming
choice — see [01-capture-and-detection.md](./docs/plan/01-capture-and-detection.md)'s
"Architecture" section. When adding code, put pure logic (no DOM, no
camera, no OpenCV.js side effects beyond taking an already-initialized
`cv` instance as a parameter) in `src/core` with tests; everything else
belongs in `src/shell` or `src/workers` and stays untested.

## Development conventions

- **TypeScript, strict mode, no UI framework.** Plain DOM/Canvas APIs.
  Don't introduce React/Svelte/etc.
- **No premature abstraction.** This is a small, specific app — prefer
  simple, explicit, single-responsibility modules over generic/reusable
  frameworks for problems the app doesn't have yet.
- **OpenCV.js via dependency injection.** Functions that need OpenCV.js
  (in `src/core`) take an already-initialized `cv` instance as an
  explicit parameter rather than importing/awaiting a global singleton
  — keeps the core pure and trivially testable.
- **Concrete tolerance/tuning values are placeholders.** Detection
  tolerances (`src/shell/config.ts`) and various thresholds in
  `src/core/constants.ts` are documented, reasoned-about defaults, not
  empirically validated against real cameras yet — expect to retune
  them against real devices. See each plan doc's "Open Questions".
- Design/architecture decisions and their rationale live in
  `docs/plan/*.md`, not in code comments alone — check there before
  changing how a module fits into the overall flow, and update the
  relevant doc if a change alters the as-built behavior it describes.
