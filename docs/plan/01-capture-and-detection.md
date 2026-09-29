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
   expected edge locations, coloring each of the guide's 4 edges live —
   red once that edge has been found in the most recently evaluated
   frame, green while it hasn't — with a brief white flash the moment all
   4 are found at once, so the user gets continuous per-edge feedback
   rather than a silent wait. A "TOP" indicator, rotated to match the
   expected card orientation (see Orientation Handling), stays overlaid
   throughout so the user knows which way to hold the card. The **first
   frame that yields a valid quadrilateral** (four fitted edges whose
   intersections form a quad matching the target aspect ratio within
   tolerance) is accepted immediately — no multi-frame stability voting
   for *acceptance* (see step 5 for the separate multi-frame step that
   follows acceptance).
5. On acceptance, the loop stops, but the guide overlay stays visible
   while a short burst of further frames is captured and the sharpest,
   best-aligned one is selected (see Multi-Frame Capture & Selection) —
   rather than committing to the exact frame that happened to trigger
   acceptance. The selected frame's accepted quad geometry is used to
   run a perspective transform that flattens/crops it to just the card.
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
- **Raw-capture placement convention (input to this rule, not its
  output).** During scanning, the guide teaches the user to physically
  place a mismatched-format card (landscape card on a portrait camera, or
  portrait card on a landscape camera) so its own top edge faces the
  **left** side of the camera's view — always this one direction, never
  "whichever is closer," so the raw flattened crop's orientation is a
  deterministic, known quantity rather than something the user could get
  two different (180°-apart) ways. This is a UX contract enforced by
  on-screen guidance (exact presentation is the imperative shell's job),
  not something the detector can verify from pixels alone — the
  functional core is entitled to assume it holds.
- **Output rotation (this rule's actual job).** Given that raw-capture
  convention, `computeOutputRotationDegrees` corrects the flattened crop
  to be presented **upright** (matching UX flow step 6's "so the artwork
  is presented upright"):
  - Print format matches the device-orientation category (portrait card
    + portrait camera, or landscape card + landscape camera) → no extra
    rotation beyond the perspective flatten.
  - Mismatched → the raw crop has the card's top edge sitting on the
    left (per the convention above); rotate it so that top edge moves to
    the top of the frame instead — i.e. undo the left-ward placement,
    not repeat it.
- **On-screen orientation guidance (implemented).** Since the raw-capture
  placement convention above is a UX contract the user has to follow, not
  something the detector can verify, the guide overlay draws a "TOP" label
  on whichever frame edge the card's own top should be placed against —
  derived from the same `computeOutputRotationDegrees` inputs (camera
  orientation, card print format) and rotated to read upright at that
  edge. Always visible during scanning, independent of debug mode.
- This is a pure function of two enums and should be one of the smallest,
  most independently testable units in the whole phase:

  ```ts
  type CameraOrientation = "portrait" | "landscape";
  type CardOrientation = "portrait" | "landscape";

  function computeOutputRotationDegrees(
    camera: CameraOrientation,
    card: CardOrientation,
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
- **Live per-edge feedback (implemented).** Each evaluated frame's
  per-edge found/not-found status is reflected immediately on the guide
  overlay itself (red = found, green = not found), independent of and
  prior to full quad acceptance — a "getting close" signal distinct from
  acceptance, always visible (not gated behind debug mode).

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

- **Minimum resolution (stricter than originally planned).** The camera
  stream itself is required to be Full HD (1920×1080) or higher —
  enforced as a hard `min` constraint at `getUserMedia` acquisition time
  (`startCameraStream`), not just an `ideal` preference. A camera that
  can't meet this floor fails to start with a clear error rather than
  silently running at a lower, blurrier resolution. The resolution
  dropdown only offers 1080p and 4K options accordingly.
- Detection and the final flattened output both read frames directly off
  the `<video>` element at whatever resolution the stream negotiated
  (guaranteed ≥ FHD per above).
- Detection and final-image capture remain separate concerns in the code
  (`evaluateFrameForQuad` vs. `captureFlattenedCard`).

## Multi-frame capture & selection (not in original plan)

Rather than committing to the exact frame whose detection first triggered
acceptance, the shell captures a short burst of further frames afterward
and selects the best one — on the theory that a frame a moment later,
mid-hold, is often sharper or better-aligned than the very first frame
that happened to pass detection.

- Each burst frame is independently run through the same quad detection
  used for live detection (`collectBurstFrames`) — detection only, no
  flattening; a frame whose own detection doesn't accept a quad is simply
  skipped, not retried. Only the single selected frame is flattened.
- Frames are attempted one after another until
  `CAPTURE_BURST_MIN_USABLE_FRAMES` (2) have been accepted, up to a hard
  ceiling of `CAPTURE_BURST_HARD_LIMIT` (10) total frames attempted — so a
  run of early rejections (card briefly moved, occluded, etc.)
  doesn't strand the user with too few candidates to choose from. If the
  hard limit is hit with only one usable frame, that frame is still used
  rather than failing outright; only a burst that captures *zero* usable frames falls back to
  the original preview-triggering frame.
- The best candidate is picked by `selectBestFrame`
  (`src/core/frameQuality.ts`), combining two signals, each normalized
  0–1 against the candidate set and summed with equal weight:
  - **Sharpness** — Laplacian variance (`laplacianVariance`), a standard
    blur-detection measure, of the card's bounding box in the raw frame.
  - **Quad geometry match** — how closely the accepted quad's measured
    aspect ratio (`quadAspectRatio`) matches the target card aspect ratio.
- All 4 constants above are starting guesses (`src/core/constants.ts`),
  flagged there as tuning targets once real-device empirical data is
  available, same as the other tolerance values in this plan.

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
  card: CardOrientation,
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
- Multi-frame burst capture and selection after acceptance, and the
  final canvas draw/export.

## Data contracts

```ts
type Orientation = "portrait" | "landscape";
type CardOrientation = "portrait" | "landscape";

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
}
```

## Open questions / risks

Not resolved by this plan — flagged for a decision before or during
implementation:

1. **Occlusion/background robustness is unvalidated.** Needs empirical
   testing against real hand-held photos before committing to the
   "no controlled background" target as the shipped default.
2. ~~Quality/focus/readability filtering~~ — resolved: implemented as
   part of this phase (see Multi-Frame Capture & Selection), not deferred
   to Phase 2.
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
  an automatic *acceptance* within a bounded time, with no multi-frame
  stability wait — a brief multi-frame capture/selection step (see
  Multi-Frame Capture & Selection) follows acceptance before output.
- The output image is a flattened, cropped, correctly oriented (per the
  print-format rule) image of just the card, at Full HD or higher.
- Misaligned or card-free frames are rejected fast enough that the live
  preview doesn't visibly stall.
- Works with both a phone browser (`getUserMedia`) and a desktop/laptop
  webcam.
