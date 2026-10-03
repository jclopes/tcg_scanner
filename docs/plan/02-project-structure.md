# Project Structure & Tooling

> **Historical record of the initial scaffold (September 2026).** Since
> then, OpenCV.js and `src/workers/` were removed (October 2026): image
> processing is plain TypeScript in `src/core`, and edge detection runs on
> the main thread. See the [README](../../README.md) for the current layout.

This document is the reference for how the project is wired up. It exists
so later stages can build on top of the scaffolding without needing the
conversation that created it. Nothing here implements any detection,
camera, or UI logic — see
[01-capture-and-detection.md](./01-capture-and-detection.md) for that.

## Tooling choices

- **Package manager: npm.** No workspace/monorepo needs yet; npm is the
  default and requires no extra setup.
- **Language: TypeScript, strict mode.** `tsconfig.json` has `strict: true`
  plus `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch` for
  extra safety on the array/enum-heavy geometry code the plan describes.
  `moduleResolution: "bundler"` matches how Vite resolves imports.
  TypeScript is used only for type-checking (`tsc --noEmit`); Vite/esbuild
  does the actual transpilation, which is why `noEmit: true` is set.
- **Dev server / bundler: Vite.** Zero-config for a vanilla-TS, no-framework
  project, fast dev server, sane production build. This matches the plan's
  "simplicity over convenience" principle and its explicit rule against a
  UI framework.
- **Test runner: Vitest.** Shares Vite's config/transform pipeline, so no
  separate build setup for tests. The functional core described in the
  plan (pure functions like `fitEdgeLine`, `intersectLines`,
  `validateQuad`, `computeOutputRotationDegrees`) is meant to be
  unit-tested with it, without a browser or camera.
  - `vite.config.ts` sets `test.passWithNoTests: true` because `src/core`
    is currently empty — remove that flag once real tests exist, so an
    accidentally-empty suite starts failing loudly again.
- **Computer vision: `@techstark/opencv-js` (npm) — removed in October
  2026, see the note at the top.** The plan calls for
  OpenCV.js (WASM) but doesn't specify how to bring it into a TS/Vite
  project. Judgment call: used the `@techstark/opencv-js` npm package
  (Apache-2.0, actively maintained, mirrors the official
  `docs.opencv.org` builds — currently OpenCV 5.0.0) rather than the
  first result on npm (`opencv.js`, an old, sparsely-maintained package)
  or manually vendoring a downloaded `opencv.js` file into `public/`.
  This keeps OpenCV.js a normal versioned dependency. No polyfills were
  needed — Vite externalizes the package's unused Node.js
  `fs`/`crypto` references automatically, since they're only referenced
  in a codepath that never runs in the browser.
  - The bundled OpenCV.js WASM+glue is large (~15 MB unminified, ~4 MB
    gzipped), which triggers Vite's default chunk-size warning on build.
    This is inherent to shipping OpenCV.js and not a scaffolding problem;
    a later stage can code-split it behind a dynamic `import()` if actual
    load-time profiling calls for it. Left alone for now to avoid
    speculative optimization.
- **No linter/formatter.** Per instructions, only added if genuinely
  zero-effort; skipped. TypeScript strict mode is the quality bar for now.

## Folder layout

```
index.html          Entry HTML page, loads src/main.ts as a module.
src/
  main.ts           Minimal entry point: waits for OpenCV.js to initialize
                     and shows a plain-text status on screen. No camera,
                     no Scan button, no guide overlay yet.
  core/              Functional core (empty scaffold).
                     Pure, browser-free, unit-testable functions —
                     everything under "Functional core" and "Data
                     contracts" in 01-capture-and-detection.md:
                     computeGuideGeometry, expectedEdgeBands, fitEdgeLine,
                     intersectLines, validateQuad,
                     computePerspectiveTransform,
                     computeOutputRotationDegrees, and the shared types
                     (Size, Point, GuideRect, EdgeBand, FittedLine,
                     QuadValidationResult, CaptureResult, etc). No DOM,
                     no camera, no OpenCV side effects — pass pixel data
                     in, get results out. This is what most of the unit
                     tests (via `npm test`) should target.
  shell/             Imperative shell (empty scaffold).
                     Camera/DOM/UI/orientation code — getUserMedia,
                     permission handling, guide overlay rendering, the
                     Scan-button state machine, the frame-sampling loop
                     (requestVideoFrameCallback/requestAnimationFrame),
                     ImageCapture/high-res still handling, and the worker
                     pool's message-passing (dispatch bands, collect
                     results) as described in the plan's "Imperative
                     shell" section. Calls into src/core for all actual
                     computation.
  workers/           Web Worker pool (empty scaffold).
                     The 4 edge-detection workers described in
                     "Detection strategy" / "Parallel per-edge detection".
                     Each worker should import fitEdgeLine (and any other
                     pure functions it needs) from src/core — the worker
                     files themselves should stay thin message-handling
                     wrappers. Note: worker files will need
                     `/// <reference lib="webworker" />` at the top (or an
                     equivalent per-file lib override) since the project
                     tsconfig's `lib` is DOM-only, not WebWorker — this
                     was left DOM-only for now since there's no worker
                     code yet to conflict with it.
docs/plan/           Planning docs (this file and the phase specs).
```

`src/core`, `src/shell`, and `src/workers` currently contain only a
`.gitkeep` placeholder each, so git tracks the empty directories.

## Running the project

```sh
npm install        # install dependencies (first time / after pulling)
npm run dev         # start the Vite dev server (http://localhost:5173)
npm run build       # type-check (tsc --noEmit) then produce a production build in dist/
npm test            # run the Vitest suite once (npm run test -- --watch for watch mode)
```

All three were run against this scaffold and confirmed working:
`npm run dev` serves `index.html`, which loads `src/main.ts` and updates
the on-page status text to `OpenCV ready (Version control: 5.0.0)` once
OpenCV.js finishes initializing (verified in an actual browser tab, not
just via curl); `npm run build` type-checks cleanly and emits
`dist/index.html` + a bundled JS asset; `npm test` runs Vitest and exits
0 with "No test files found" (expected — `src/core` has no tests yet).
