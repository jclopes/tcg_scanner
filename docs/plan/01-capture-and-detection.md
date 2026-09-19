# Phase 1 — Live Capture & Detection

## Goal

Given a live camera feed, detect when a physical trading card is present
and reasonably aligned, and produce a perspective-corrected ("flattened"),
tightly cropped, maximum-resolution image of just that card — entirely
client-side, fast enough to evaluate every incoming frame without
stalling the live preview.

## Out of scope for this phase

- Identifying *which* card it is (Phase 2).
- Persisting/cataloging results (Phase 3).
- Quality/focus/readability filtering of the captured image. The idea was
  raised (filter detected frames by quality at a "later stage") but it's
  not decided whether that's the tail end of this phase or part of
  Phase 2 — see Open Questions.
- Multiple cards in frame at once.

## Physical card model

- One aspect-ratio profile covers every game in scope: **63mm × 88mm**
  (2.5in × 3.5in), ratio ≈ 0.7159 (short:long side). Define as a named
  constant, not inlined, so a differently-sized game could be added later
  without touching detection logic.
- Physical corners are rounded. Detection deliberately never relies on
  corner geometry directly — see Detection Strategy.

## UX flow

1. User presses **Scan**.
2. A guide overlay appears: a rectangle using the card's aspect ratio,
   **oriented to match the current camera/device orientation** (portrait
   camera → tall guide; landscape camera → wide guide), sized to fill
   most of the frame so the sampled card region is as high-resolution as
   possible, with a margin for the user's positioning tolerance.
3. The user has already selected the physical card's print format —
   **Portrait** or **Landscape** — for this scan (see Orientation
   Handling). This is about the artwork's own orientation on the card
   stock, independent of the guide's shape. The choice is **sticky for
   the session**: it stays set across scans until the user explicitly
   changes it, since a user is typically batch-scanning several cards of
   the same format in a row.
4. The live detection loop evaluates incoming frames against the guide's
   expected edge locations. The **first frame that yields a valid
   quadrilateral** (four fitted edges whose intersections form a quad
   matching the target aspect ratio within tolerance) is accepted
   immediately — no multi-frame stability voting.
5. On acceptance, the loop stops. A high-resolution still is captured
   (see Device & Resolution Handling), the accepted quad's geometry is
   mapped onto that image, and a perspective transform flattens/crops it
   to just the card.
6. The flattened image is rotated per the print-format rule (Orientation
   Handling) so the artwork is presented upright.
7. Output: the flattened, correctly oriented card image — handed to
   Phase 2, or displayed/saved locally for now.

## Orientation handling

- The guide's shape is a pure function of **camera orientation only**,
  never of card print format: portrait camera → portrait-shaped guide
  (height > width); landscape camera → landscape-shaped guide
  (width > height). A landscape-print card scanned on a portrait camera
  still has to fit inside a portrait-shaped guide, and vice versa.
- The user-selected print format only affects the **rotation applied to
  the final image**:
  - Print format matches the device-orientation category (portrait card
    + portrait camera, or landscape card + landscape camera) → no extra
    rotation beyond the perspective flatten.
  - Mismatched (landscape card on portrait camera, or portrait card on
    landscape camera) → rotate the flattened output so the card's top
    edge ends up on the **left** side of the frame. Always this
    direction for both mismatch cases — one consistent rule, not
    "whichever is closer."
- This is a pure function of two enums and should be one of the smallest,
  most independently testable units in the whole phase:

  ```ts
  type CameraOrientation = "portrait" | "landscape";
  type CardPrintFormat = "portrait" | "landscape";

  function computeOutputRotationDegrees(
    camera: CameraOrientation,
    card: CardPrintFormat,
  ): 0 | 90 | 180 | 270 { /* ... */ }
  ```

## Detection strategy

- **Search-space reduction.** The guide tells us exactly where each of
  the 4 edges is expected, within a tolerance band for the user's
  positioning/rotation/zoom error. Each frame is evaluated by scanning 4
  small, independent pixel bands (one per guide edge) rather than the
  whole frame.
- **Per-edge line fitting, not corner detection.** Within each band, find
  the dominant straight line (OpenCV.js: gradient/Canny response +
  `HoughLinesP` or an equivalent robust line fit over edge points). This
  is deliberately edge-based rather than corner- or full-contour-based,
  for two reasons:
  - Real card corners are rounded, so fitting a 4-point polygon to the
    whole contour is unreliable exactly where it matters most (the
    corners).
  - It tolerates partial occlusion — e.g. a finger holding the card near
    an edge — as long as enough of that edge's straight run is visible
    elsewhere in its band.
- **Corner reconstruction.** The 4 corners are the pairwise intersections
  of the 4 fitted lines (adjacent pairs) — never sampled directly from
  the image.
- **Parallel per-edge detection.** The 4 edge bands are independent of
  each other, so they're detected **in parallel across 4 Web Workers**
  (one per edge, or a small worker pool reused across frames) rather than
  sequentially on the main thread. Each worker receives just its band's
  pixel data and runs `fitEdgeLine` in isolation; the main thread collects
  all 4 results before running `intersectLines`/`validateQuad`. This is a
  Phase 1 requirement, not a later optimization — fast, reliable edge
  detection is the priority this phase is judged on.
- **Fail-fast within each worker.** Run cheap early-exit checks (e.g. "is
  there any meaningful gradient in this band at all") before the more
  expensive line fit — most frames will be discarded, and the loop needs
  to keep up with the camera's frame rate.
- **Quad validation** (main thread, after collecting all 4 workers'
  results). Reject the frame immediately if any edge line couldn't be fit
  confidently, or if the resulting quad's side-length ratio falls outside
  the tolerance band around the target aspect ratio.

## Background & occlusion (staged target)

- **Primary target:** a hand-held card against a cluttered background,
  with fingers possibly occluding parts of the card near its edges. The
  per-edge/line-fit strategy above is chosen specifically because it
  degrades gracefully under partial occlusion and doesn't depend on
  segmenting the card from its background via one global contour.
- **Fallback, if that proves unreliable:** a UX change, not an
  architecture change — instruct the user to place the card on a plain,
  contrasting surface (e.g. a sheet of white paper). No separate code
  path is needed; a plain background just makes the same detection logic
  easier.
- This needs empirical validation against real hand-held photos once a
  first build exists — see Open Questions.

## Device & resolution handling

- **Live preview stream:** configured at a frame size that keeps
  per-frame detection fast. Detection runs against the preview
  resolution, not full sensor resolution.
- **Final capture:** attempt `ImageCapture.takePhoto()` (or
  `grabFrame()`) for a full-resolution still on devices/browsers that
  support it. The accepted quad's geometry is re-derived/rescaled onto
  that still (same relative guide position, scaled to the still's
  resolution) before the perspective warp. Where `ImageCapture` isn't
  supported (notably some desktop webcam/browser combinations), fall
  back to using the accepted preview frame directly.
- Detection and final-image capture are deliberately separate concerns:
  detection produces a quad in preview-frame coordinates; a separate step
  maps that geometry onto whichever image source is used for the final
  output.

## Architecture: functional core / imperative shell

**Functional core** — pure functions, unit-testable without a browser or
camera:

```ts
function computeGuideGeometry(
  camera: CameraOrientation,
  frameSize: Size,
): GuideRect { /* ... */ }

function expectedEdgeBands(
  guide: GuideRect,
  tolerance: ToleranceConfig,
): [EdgeBand, EdgeBand, EdgeBand, EdgeBand] { /* ... */ }

function fitEdgeLine(samples: EdgeBandPixels): FittedLine | null { /* ... */ }

function intersectLines(a: FittedLine, b: FittedLine): Point { /* ... */ }

function validateQuad(
  corners: [Point, Point, Point, Point],
  targetAspectRatio: number,
  tolerance: ToleranceConfig,
): QuadValidationResult { /* ... */ }

function computePerspectiveTransform(
  corners: [Point, Point, Point, Point],
  outputSize: Size,
): Matrix3x3 { /* ... */ }

function computeOutputRotationDegrees(
  camera: CameraOrientation,
  card: CardPrintFormat,
): 0 | 90 | 180 | 270 { /* ... */ }
```

**Imperative shell** — browser I/O and side effects:

- Camera stream acquisition and permission handling (`getUserMedia`).
- Orientation change detection (sensor/media-query watching).
- Rendering the guide overlay and the Scan-button state machine.
- The frame-sampling loop (`requestVideoFrameCallback` or
  `requestAnimationFrame`), calling into the functional core per frame
  and stopping on the first accepted quad.
- The worker pool: spawning/reusing the 4 edge-detection Web Workers,
  dispatching each frame's 4 band crops to them, and collecting their
  `FittedLine | null` results before running the (main-thread) quad
  validation. `fitEdgeLine` itself stays a pure function in the
  functional core, imported by each worker — the shell only owns the
  message-passing.
- High-resolution still capture (`ImageCapture`) with the preview-frame
  fallback, and the final canvas draw/export.

## Data contracts

```ts
type Orientation = "portrait" | "landscape";
type CardPrintFormat = "portrait" | "landscape";

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface GuideRect {
  center: Point;
  width: number;
  height: number;
  orientation: Orientation;
}

interface EdgeBand {
  // The narrow region of the frame this edge is expected to fall within.
  region: { origin: Point; size: Size };
  // Which side of the guide this band corresponds to.
  side: "top" | "right" | "bottom" | "left";
}

interface FittedLine {
  // Any two-point (or point+direction) representation is fine —
  // pick whichever the chosen line-fit routine outputs most directly.
  point: Point;
  direction: Point;
  confidence: number;
}

interface QuadValidationResult {
  valid: boolean;
  corners: [Point, Point, Point, Point] | null;
  reason?: "edge-not-found" | "aspect-ratio-out-of-tolerance";
}

interface CaptureResult {
  image: ImageBitmap; // flattened, cropped, upright
  sourceResolution: Size; // resolution the crop was taken from
  usedHighResStill: boolean; // false if it fell back to the preview frame
}
```

## Open questions / risks

Not resolved by this plan — flagged for a decision before or during
implementation:

1. **Occlusion/background robustness is unvalidated.** Needs empirical
   testing against real hand-held photos before committing to the
   "no controlled background" target as the shipped default.
2. **Quality/focus/readability filtering** was mentioned as happening "at
   a later stage" — not yet decided whether that's the tail end of this
   phase (before handing the image to Phase 2) or genuinely part of
   Phase 2. Needs a decision before Phase 2 is planned.
3. **Concrete tolerance values** (position/rotation/zoom tolerance,
   aspect-ratio tolerance band) are left as tunable parameters in
   `ToleranceConfig`, not fixed numbers — they need empirical tuning
   once a first build exists, not upfront guessing.
4. **Worker pool sizing/lifecycle.** 4 workers matches 4 edges, but
   whether to spawn exactly 4 fixed workers reused across frames, or a
   pool sized to `navigator.hardwareConcurrency`, is an implementation
   detail to settle once real device profiling is possible (thread
   spin-up cost vs. availability on low-core devices).

## Acceptance criteria

- On a supported browser (mobile or desktop), pressing Scan shows a live
  camera feed with a guide overlay matching the device's current
  orientation.
- Holding a standard-sized card roughly aligned to the guide results in
  an automatic capture within a bounded time, with no multi-frame
  stability wait.
- The output image is a flattened, cropped, correctly oriented (per the
  print-format rule) image of just the card, at the best resolution the
  device/browser can provide.
- Misaligned or card-free frames are rejected fast enough that the live
  preview doesn't visibly stall.
- Works with both a phone browser (`getUserMedia`) and a desktop/laptop
  webcam.
