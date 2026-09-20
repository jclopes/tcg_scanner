# Phase 1 — Imperative Shell: As-Built Reference

This document describes `src/shell/` — the browser I/O layer (camera,
guide overlay, Scan button, frame-sampling loop, capture) — and how it's
wired into `src/main.ts`/`index.html`. It assumes the reader has already
read [01-capture-and-detection.md](./01-capture-and-detection.md),
[03-functional-core.md](./03-functional-core.md) and
[04-worker-pool.md](./04-worker-pool.md); this stage treats `src/core` and
`src/workers`'s public APIs as fixed contracts and didn't modify either,
except for one addition described below.

## One addition to `src/core`: `pixelExtraction.ts`

The task identified "convert a region of raw pixel data into the
`EdgeBandPixels` grayscale shape `fitEdgeLine` expects" as plain array math
with no DOM dependency once a pixel buffer exists — so it lives in
`src/core/pixelExtraction.ts` (exported from `src/core/index.ts`, tested in
`src/core/pixelExtraction.test.ts`, 7 tests), not `src/shell`. It exports
one pure function:

```ts
function extractGrayscaleRegion(
  source: RgbaPixelBuffer, // { data: Uint8ClampedArray; width; height } — same shape as ImageData
  region: { origin: Point; size: Size },
): EdgeBandPixels
```

It rounds fractional region coordinates to the nearest pixel, clamps the
region to the source's actual bounds (a tolerance-widened band can extend
past the frame edge), and converts to grayscale with Rec. 601 luma weights
(`0.299R + 0.587G + 0.114B`). A region that clamps to zero width/height
(including one entirely outside the source) returns `{ width: 0, height: 0,
data: new Uint8ClampedArray(0) }` — no special-casing needed by callers,
since `fitEdgeLine` already treats `width < 2 || height < 2` as
"not found".

The impure half — actually reading pixels off a live `<video>`/`<canvas>` —
stays in `src/shell/frameSampler.ts` and calls this.

## `src/shell/` file tree

```
src/shell/
  config.ts             DEFAULT_TOLERANCE_CONFIG + PREVIEW_STREAM_SIZE (placeholder tuning values)
  state.ts               ScanPhase / ScanState (the explicit state machine's data shape)
  cameraStream.ts         getUserMedia acquisition, error mapping, teardown
  orientationWatcher.ts   Derives/watches Orientation from the live video's frame dimensions
  guideOverlay.ts         Draws/clears the guide rectangle on the overlay canvas
  frameSampler.ts         Impure: reads a video frame's pixels, calls core's extractGrayscaleRegion per band
  detectionLoop.ts        The rVFC/rAF per-frame detect-and-validate loop
  capture.ts              Final still capture, corner rescale, perspective warp (OpenCV.js), upright rotation
  app.ts                  Orchestrator: DOM wiring, event handlers, the state machine
```

Each file owns exactly one concern, per the task's "no premature
abstraction" / "single-responsibility modules" constraint; `app.ts` is the
one file allowed to know about all the others and about `index.html`'s
concrete element IDs.

## How the pieces fit together

### 1. Camera acquisition — `cameraStream.ts`

`startCameraStream(video)` calls `getUserMedia` with
`facingMode: { ideal: "environment" }` (back camera preferred, but not
`exact` — most laptop webcams have no "environment" camera at all, and
`exact` would make acquisition fail outright on those instead of just using
whatever camera exists, per the plan's "works with both phone and desktop
webcam" acceptance criterion) and a preview-resolution hint
(`PREVIEW_STREAM_SIZE`, 1280×720, `ideal` not `exact`/`min`). It resolves
once video metadata has loaded and playback started; it throws a
human-readable `Error` (mapped from `DOMException.name`) on permission
denial, no camera, camera-in-use, or `getUserMedia` being unsupported at
all — surfaced by `app.ts` as an `"error"` state with a visible message,
never a silent failure.

### 2. Print-format selection — `app.ts`

Two toggle buttons (`#format-portrait`/`#format-landscape` in
`index.html`) set a module-level `cardFormat: CardPrintFormat` variable in
`app.ts`, defaulting to `"portrait"`. In-memory only — sticky for the
session, resets on reload, exactly as the plan asks for ("no persistence
requirement beyond until the page reloads").

### 3. Orientation detection — `orientationWatcher.ts`

`getVideoOrientation(video)` is `video.videoWidth > video.videoHeight ?
"landscape" : "portrait"` — derived from the live video's actual reported
frame dimensions, never a device/screen-orientation API, per the task's
explicit instruction (the guide is tied to camera/frame orientation, not
device chrome). `watchVideoOrientation(video, onChange)` subscribes to the
video element's own `"resize"` event (which `HTMLVideoElement` fires
whenever `videoWidth`/`videoHeight` change intrinsically — e.g. the camera
stream renegotiates after a device rotation) plus `"loadedmetadata"` for
the first reading, and calls `onChange` on every dimension change (even a
same-category one, since guide geometry depends on the concrete frame size
too). `DetectionLoop` re-derives orientation this same way independently,
every frame, from the video element directly — it doesn't depend on the
watcher's callback at all, so detection is always correct even if a resize
event were somehow missed.

### 4. Guide overlay — `guideOverlay.ts`

`drawGuideOverlay(canvas, orientation, frameSize)` sets the overlay
canvas's internal pixel buffer (`canvas.width`/`height`) to exactly
`frameSize` (the video's intrinsic size) and draws `computeGuideGeometry`'s
rectangle directly in that same coordinate space — no scaling math needed
inside this function. Getting the canvas's *rendered* CSS box to align with
the video's is handled in `app.ts` + `index.html`'s CSS: the
`#camera-stage` container's CSS `aspect-ratio` is kept in sync with the
video's live intrinsic aspect ratio (set from the orientation-watcher
callback), and both `<video>` (`object-fit: cover`) and `<canvas>` fill
that container at 100% width/height. Since the container's aspect ratio
always matches the video's own, there's no letterboxing/cropping mismatch
between the two — a 1:1 pixel mapping holds. The overlay is only drawn
while `state.phase === "scanning"` (once when scanning starts, and again on
any live resize event during scanning) and cleared when leaving that phase
— it doesn't redraw every animation frame, since guide geometry only
changes when the frame size/orientation does.

### 5. State machine — `state.ts` / `app.ts`

```ts
type ScanPhase = "idle" | "scanning" | "processing" | "captured" | "error";
```

Beyond the task's minimum (idle/scanning/captured), `"processing"` was
added as its own explicit phase for the gap between "a frame was accepted
and the loop stopped" and "the capture/flatten/rotate step finished" —
different enough from `"scanning"` (no loop running, no guide shown) and
from `"captured"` (no result yet) to deserve its own named state rather
than an ad-hoc flag. `"error"` carries a `message` for the visible error
banner. `app.ts`'s `render()` is the single function that maps `state` (plus
a `cameraAvailable` flag) onto DOM: status text, Scan button
label/disabled, and result-section/camera-stage visibility — no scattered
booleans.

The Scan button's label/behavior per phase: `"idle"`/`"error"` → "Scan"
(enabled once the camera is available); `"scanning"` → "Scanning…"
(disabled); `"processing"` → "Capturing…" (disabled); `"captured"` → "Scan
Again" (enabled — clicking it in this phase goes straight back into
`"scanning"` in the same click, via the same click handler's `beginScan()`
call that `"idle"`/`"error"` use; it does not pass through `"idle"` first.
See Judgment calls below for why.).

### 6. The frame-sampling loop — `detectionLoop.ts`

`DetectionLoop.start(onAccepted)` schedules `evaluateFrame()` via
`video.requestVideoFrameCallback` when available (ties evaluation to actual
new camera frames, not the display refresh rate — the more correct choice
for a camera feed), falling back to `requestAnimationFrame`.
`requestVideoFrameCallback` fires once per registration, so `start()`'s
step function re-schedules itself after every evaluated frame rather than
being a persistent subscription.

Each evaluated frame: reads `video.videoWidth`/`videoHeight`, derives
orientation, runs `computeGuideGeometry` → `expectedEdgeBands(guide,
DEFAULT_TOLERANCE_CONFIG)`, samples all 4 bands via `FrameSampler` (one
`getImageData` call over the whole frame, then `extractGrayscaleRegion`
per band — see Judgment calls), calls `pool.detectEdges(...)`. If any of
the 4 results is `null`, the frame is discarded (per `src/core`'s
documented contract: a missing edge is the caller's job to short-circuit
on before ever calling `validateQuad`). Otherwise each `FittedLine` is
translated from band-local to frame coordinates (`point.x/y +=
band.region.origin.x/y`, per `FittedLine`'s doc comment), the 4 corners are
reconstructed via `intersectLines` on adjacent band pairs
(`[topLeft, topRight, bottomRight, bottomLeft]`, matching `src/core`'s
corner-order convention), and `validateQuad` checks the aspect ratio. A
`null` edge, a parallel-lines exception from `intersectLines` (adjacent
edges detected as parallel — a genuine per-frame failure, not a bug), or a
failed `validateQuad` all just discard the frame and continue — nothing
ever blocks or visibly stalls the loop, per the plan's fail-fast
requirement. The first frame that produces a valid quad calls `stop()`
*then* `onAccepted(result)`.

### 7. Capture on success — `capture.ts`

`captureFlattenedCard(input)`:

1. **Still image**: tries `ImageCapture.takePhoto()` first (a genuine
   full-resolution photo, where supported), then `ImageCapture.grabFrame()`
   as a second-choice fallback, then finally just draws the current
   `<video>` frame onto a canvas if `ImageCapture` isn't supported at all
   or both calls throw — feature-detected via `typeof ImageCapture !==
   "undefined"`. Returns `usedHighResStill: true` only for the first two
   paths.
2. **Rescale corners**: `scaleX/Y = stillSize / previewFrameSize`; each of
   the 4 accepted corners (in preview-frame coordinates from
   `DetectionLoop`) is multiplied by that ratio, since the still can have
   different pixel dimensions than the preview frame the quad was detected
   in.
3. **Output size**: chosen as the scaled quad's own measured side lengths
   (`distance(topLeft, topRight)` for width, `distance(topLeft,
   bottomLeft)` for height), rounded — not a fixed constant — so the
   output preserves as much of the still's actual resolution as the quad
   occupies, rather than down/up-sampling to an arbitrary fixed size (see
   Judgment calls).
4. **Warp**: `computePerspectiveTransform` (from `src/core`) produces the
   `Matrix3x3`; `cv.warpPerspective` (OpenCV.js) applies it onto a canvas
   via `cv.imread`/`cv.imshow`.
5. **Rotate**: `computeOutputRotationDegrees(camera, cardFormat)` from
   `src/core` gives `0 | 90`; a 90° rotation is applied via
   `ctx.translate/rotate/drawImage` onto a new canvas with swapped
   width/height.

### 8. Display the result — `app.ts`

On success, the final canvas is drawn to `#result-image` via
`canvas.toDataURL("image/png")`, `#camera-stage` is hidden, `#result` is
shown, and the phase becomes `"captured"`. Clicking the Scan button again
clears the result image and goes straight back into `"scanning"` (camera
stage shown again, live preview still running — the stream was never
stopped during capture) — see the "Scan Again" judgment call below for why
this skips `"idle"`.

## Judgment calls (and reasoning)

- **`DEFAULT_TOLERANCE_CONFIG`** (`src/shell/config.ts`): `positionTolerance
  = 0.08`, `rotationToleranceDegrees = 8`, `zoomTolerance = 0.08`,
  `aspectRatioTolerance = 0.1`. Explicitly placeholder values per the
  plan's Open Questions #3 (needs empirical tuning against real devices) —
  chosen to be generous enough for imprecise hand-holding without being so
  loose the bands start overlapping background clutter. The aspect-ratio
  tolerance is deliberately the most generous of the four, since ordinary
  perspective foreshortening skews the *measured* ratio even for a
  well-aligned card. **This is the single most important set of numbers
  for the next reviewer to re-tune against real camera frames** — see
  "What I couldn't verify" below.
- **`PREVIEW_STREAM_SIZE = 1280×720`**: a moderate preview resolution
  requested via `ideal` (never `exact`), keeping per-frame Canny/Hough
  cost bounded without failing acquisition on devices that can't hit it.
- **Worker pool creation is lazy**, not eager at camera-start: the pool
  (and its 4 OpenCV.js/WASM instances) is created on the *first* Scan
  press, not when the camera starts. The plan's own worker-pool doc says
  "call this once, e.g. when the scan view mounts" — since this app has
  exactly one view/scan session for its whole lifetime, "mounts" was read
  as "the user actually starts scanning," not "the page loads," so a user
  who loads the page but never presses Scan never pays the 4x WASM
  warm-up cost. The pool is still created once and reused across every
  subsequent scan in the session (not recreated per scan).
- **Output image size in `capture.ts`** is derived from the detected
  quad's own measured pixel dimensions on the final still, not a fixed
  constant — maximizes preserved resolution per the plan's "maximum
  resolution the device/browser can provide" language, at the cost of
  output dimensions varying scan-to-scan (acceptable for Phase 1's
  "displayed/saved locally for now" output goal; Phase 2 can normalize
  size later if it needs to).
- **`cv.warpPerspective` (OpenCV.js) over hand-rolled canvas transform
  math**: `src/core` already builds the transform via
  `cv.getPerspectiveTransform`, and Canvas 2D's `ctx.transform` is affine
  — no projective/perspective term — so a true perspective warp isn't
  expressible with it without hand-rolling per-pixel remapping. Reusing
  OpenCV.js keeps this on the one CV dependency the project already has.
- **"Scan Again" goes straight back into `"scanning"`, not through
  `"idle"` first.** In `app.ts`'s `scanButton` click handler, the
  `"captured"` branch clears the result image and calls the same
  `beginScan(pool)` the `"idle"`/`"error"` branches use — which immediately
  sets `phase: "scanning"`. There is no intermediate `"idle"` state visited
  and no second click required. This was a deliberate choice for
  batch-scanning several cards of the same format in a row (the scenario
  the plan's sticky print-format toggle exists for) — requiring "Scan
  Again" → wait on `"idle"` → press "Scan" again would add a needless extra
  click to that workflow. (An earlier draft of this doc incorrectly
  described this as returning to `"idle"`; that was a doc bug, not a
  behavior change — the code has always auto-restarted directly.)
- **A single `<img>`/Scan button pair is reused across all phases**
  (`index.html` doesn't have separate "Scan" and "Scan Again" elements) —
  simpler DOM, and the task's step 8 phrasing ("a way to scan again") didn't
  require a dedicated second button.
- **`FrameSampler` reads the whole video frame's pixels once per evaluated
  frame** (`getImageData` over the full `videoWidth × videoHeight`) rather
  than 4 separate smaller reads, then crops out each band from that one
  buffer via `extractGrayscaleRegion`. Simpler to reason about than 4
  partial `getImageData` calls, and avoids 4x the per-call browser
  overhead; flagged as a spot to profile on a real device if the preview
  visibly stutters (see below).
- **Camera stream is never stopped on capture/error/idle transitions**,
  only on `pagehide` (page unload) — since capture reads the live
  `MediaStream`'s track for `ImageCapture` and the plan's UX implies
  batch-scanning multiple cards without re-requesting camera permission
  each time, keeping the stream alive across the whole session was the
  simplest choice that supports that.

## What I couldn't verify myself (no camera hardware) — please check in a real browser

1. **Tolerance values are unvalidated** (see above) — the whole detection
   loop's practical accept/reject behavior against a real, hand-held card
   is the first thing to check. Expect to retune
   `DEFAULT_TOLERANCE_CONFIG` in `src/shell/config.ts`.
2. **Guide/overlay alignment**: the `#camera-stage` CSS `aspect-ratio` +
   `object-fit: cover` + 1:1 canvas-buffer-to-videoWidth/Height approach is
   sound on paper but needs an actual visual check that the drawn guide
   rectangle really does sit where a user expects relative to the live
   video, across at least one portrait-camera and one landscape-camera
   device/orientation.
3. **`requestVideoFrameCallback` support and behavior** — feature-detected
   and falls back to `requestAnimationFrame`, but I couldn't confirm the
   fallback path actually keeps up with a live camera feed at a workable
   rate on a browser that lacks rVFC.
4. **`ImageCapture.takePhoto()`/`grabFrame()` support and the fallback
   chain** — entirely untested against real hardware. In particular:
   whether `takePhoto()` throwing vs. hanging vs. succeeding-but-slow
   behaves as expected on real mobile Chrome/Safari, and whether the
   plain-video-frame fallback (desktop webcams lacking `ImageCapture`) is
   visually indistinguishable in quality from the preview.
5. **The video `"resize"` event's actual firing behavior** across browsers
   when a device is physically rotated mid-session (does the camera
   stream really renegotiate dimensions, or does the browser instead just
   apply a CSS-level rotation the video's `videoWidth`/`videoHeight` never
   reflect?) — this is the load-bearing assumption behind orientation
   re-derivation and I have no way to confirm it without a physical
   device.
6. **End-to-end permission-denial and no-camera UX** — the error-message
   mapping in `cameraStream.ts` is based on documented `DOMException` names
   but was never exercised against a real browser's permission prompt.
7. **Perf**: whether `FrameSampler`'s one full-frame `getImageData` per
   evaluated frame plus the worker round-trip actually keeps the live
   preview visibly smooth at `PREVIEW_STREAM_SIZE`, especially on a
   lower-end mobile device.

## Verification performed

- `npm run build` (`tsc --noEmit && vite build`) passes — no type errors
  across `src/core`'s new module, all of `src/shell`, and the updated
  `src/main.ts`. Same pre-existing OpenCV.js bundle-size warning as prior
  stages (documented in
  [02-project-structure.md](./02-project-structure.md)), not a new issue.
- `npm test` (Vitest) passes: 48 tests across 6 files (41 pre-existing +
  7 new in `src/core/pixelExtraction.test.ts`). Nothing in `src/shell` has
  unit tests, per the task's explicit instruction — it's DOM/camera glue
  Vitest can't meaningfully exercise (`getUserMedia`, live video frames,
  `ImageCapture`), not business logic.
- No end-to-end manual browser test of the live capture flow was possible
  in this environment (no camera hardware) — see the numbered list above.
