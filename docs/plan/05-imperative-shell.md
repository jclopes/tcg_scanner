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
  config.ts             DEFAULT_TOLERANCE_CONFIG + camera resolution options
  state.ts               ScanPhase / ScanState (the explicit state machine's data shape)
  cameraStream.ts         getUserMedia acquisition, error mapping, teardown
  orientationWatcher.ts   Orientation/frame size from the video's own dimensions; resize watcher
  guideOverlay.ts         Draws/clears the guide rectangle on the overlay canvas
  canvasUtils.ts          Shared canvas helpers (context, create/snapshot/rotate, blob URLs, frame scheduling)
  frameSampler.ts         Reads a frame's pixels, calls core's extractGrayscaleRegion per band
  frameDetection.ts       One quad-detection pass on a frame → FrameEvaluation
  detectionLoop.ts        The per-frame live detection loop
  frameBurst.ts           Post-acceptance burst of detection-only frames
  capture.ts              Perspective warp (OpenCV.js) + upright rotation of the selected frame
  debugSteps.ts           Builds/renders the debug trail
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

Two toggle buttons (`#orientation-portrait`/`#orientation-landscape` in
`index.html`) set a module-level `cardOrientation: CardOrientation` variable in
`app.ts`, defaulting to `"portrait"`. In-memory only — sticky for the
session, resets on reload, exactly as the plan asks for ("no persistence
requirement beyond until the page reloads").

### 3. Orientation detection — `orientationWatcher.ts`

`orientationFromSize(size)` is `width > height ? "landscape" : "portrait"`
— derived from the frame's own dimensions, never a device/screen-orientation
API. `videoFrameSize(video)` reads the video's intrinsic size and throws if
it has none (frames are only read from a started stream).
`watchVideoFrameSize(video, onChange)` listens to the video element's own
`"resize"` and `"loadedmetadata"` events (ignoring the 0×0 size of a
detached stream). Everything that draws or detects
re-reads the size from the video (or the frame canvas) directly rather than
caching it.

### 4. Guide overlay — `guideOverlay.ts`

`drawGuideOverlay(canvas, orientation, frameSize, edgeColors, cardOrientation)` sets the overlay
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

### 6. Frame detection and the live loop — `frameDetection.ts` / `detectionLoop.ts`

`evaluateFrameForQuad(sampler, pool, source, frameSize)` runs one pass:
`computeGuideGeometry` → `expectedEdgeBands` → `FrameSampler` (draws the
frame, then one `getImageData` + `extractGrayscaleRegion` per band) →
`pool.detectEdges` → `quadFromEdgeLines` (lines translated by each band's
clamped origin) → `isQuadAspectRatioValid`. It returns a `FrameEvaluation`
union: `{ status: "accepted", frame: { corners, frameCanvas } }` or
`{ status: "rejected", reason }` (`edge-not-found` / `parallel-edges` /
`aspect-ratio-out-of-tolerance`), always with the band pixels and lines for
the debug views.

`DetectionLoop.start({ onAccepted, onFrameEvaluated, onError })` evaluates
one frame per `scheduleVideoFrame` (`requestVideoFrameCallback`, falling
back to `requestAnimationFrame`). A rejected frame is an expected outcome:
report its edges and schedule the next frame. The first accepted frame stops
the loop and calls `onAccepted`. An unexpected failure (a crashed worker, a
video without dimensions) stops the loop and calls `onError`, which
`app.ts` shows as the `"error"` state.

### 7. Burst, selection and capture — `frameBurst.ts` / `capture.ts`

After acceptance, `collectBurstFrames` runs detection-only bursts (see
docs/plan/01-capture-and-detection.md for the frame-count policy). `app.ts`
picks the best accepted frame with core's `selectBestFrame` (card-region
sharpness + quad aspect ratio), falling back to the preview frame if no
burst frame was accepted, and only that frame is flattened.

`captureFlattenedCard(cv, frame, cardOrientation)`:

1. **Output size** (`flattenedOutputSize`): the quad's measured side
   lengths (native size — the image is for display only), snapped to the card's exact
   aspect ratio by `canonicalCardSizeFor`. Short/long sides come from the
   measured lengths, since a pre-rotation quad may be sideways.
2. **Warp** (`warpQuad`): `computePerspectiveTransform` + `cv.warpPerspective`
   from the frame canvas the quad was detected in.
3. **Rotate**: `computeOutputRotationDegrees(orientationFromSize(frame),
   cardOrientation)` gives `0 | 90`, applied with `rotateCanvas`.

### Error handling

Expected outcomes of a function's own logic are handled where they occur
(an edge not found, parallel edges, a bad aspect ratio, `ImageCapture`
unsupported → `captureHiResStill` returns `null`). Everything else
propagates: a missing 2D context (`require2dContext` throws), a worker
failure, an OCR or game-config failure all reach `failScan` in `app.ts`
and show the `"error"` state — unless that scan cycle is already stale.

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
- **Worker pool lives for the page's lifetime**: the pool (and its 4
  OpenCV.js/WASM instances) is created when the app starts, so it warms up
  while cameras are probed, and is reused by every scan — stopping a scan or
  changing camera/resolution doesn't terminate it. Only `pagehide`
  terminates it; `startScan` recreates it after a back-forward-cache
  restore.
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
- **`FrameSampler` reads back only the 4 edge bands** (one `getImageData`
  per band's clamped rect) rather than the whole frame — the bands are a
  small fraction of the frame's pixels. An accepted frame's full-resolution
  canvas is a copy of the sampler's canvas (`snapshotFrame`), taken before
  the sampler draws its next frame.
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
7. **Perf**: whether `FrameSampler`'s per-band reads plus the worker
   round-trip keep the live preview visibly smooth, especially on a
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
