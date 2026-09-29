# Phase 1 — Functional Core: API Reference

This document is the authoritative, as-built reference for everything
exported from `src/core`. It supersedes the sketch-level signatures in
[01-capture-and-detection.md](./01-capture-and-detection.md) ("Functional
core" / "Data contracts") wherever the two disagree — those sections were a
plan, this is what actually got built, including a few deliberate
refinements the plan left open. Later stages (the imperative shell in
`src/shell`, the worker pool in `src/workers`) should treat this file, not
the original plan doc, as ground truth for `src/core`'s public API.

Everything below is exported from `src/core/index.ts` (a barrel re-exporting
every module in `src/core`), so `import { ... } from "../core"` (or the
equivalent relative path) gets all of it.

## Design notes that apply to the whole module

- **Pure, browser-free, side-effect-free.** No DOM, no camera, no module-level
  mutable state. Every function's output depends only on its inputs.
- **OpenCV.js is dependency-injected, never imported.** The two functions that
  need OpenCV.js primitives (`fitEdgeLine`, `computePerspectiveTransform`)
  take an already-initialized instance as an explicit `cv: OpenCv` parameter.
  No file in `src/core` (other than `types.ts`, for the type-only alias) ever
  imports `@techstark/opencv-js` itself.
- **Corner order convention.** A `Quad` is always
  **[topLeft, topRight, bottomRight, bottomLeft]**, clockwise
  (`quadFromEdgeLines` produces it from `[top, right, bottom, left]` lines).
- **Edge-band tuple order.** `expectedEdgeBands` returns
  `[top, right, bottom, left]` (clockwise, starting at top).

## Types (`src/core/types.ts`)

| Type | Shape | Notes |
|---|---|---|
| `OpenCv` | `= CV` (re-exported from `@techstark/opencv-js`) | The already-initialized OpenCV.js instance type. Aliased so callers don't need to know which npm package provides it. |
| `Orientation` | `"portrait" \| "landscape"` | Camera/guide orientation category. (The plan's snippets sometimes call this `CameraOrientation` — unified to one name, `Orientation`, matching the plan's own "Data contracts" section.) |
| `CardOrientation` | `"portrait" \| "landscape"` | User-selected print format of the physical card, independent of `Orientation`. |
| `Size` | `{ width: number; height: number }` | |
| `Point` | `{ x: number; y: number }` | |
| `GuideRect` | `{ center: Point; width: number; height: number; orientation: Orientation }` | |
| `EdgeBand` | `{ region: { origin: Point; size: Size }; side: "top"\|"right"\|"bottom"\|"left" }` | |
| `FittedLine` | `{ point: Point; direction: Point; confidence: number }` | `direction` is unit-length; sign is arbitrary. `confidence` is in `[0, 1]`. `point`/`direction` are in whatever coordinate space the input was in (band-local for `fitEdgeLine`'s output — see below). |
| `Quad` | `readonly [Point, Point, Point, Point]` | Quad corners in the order above. |
| `ToleranceConfig` | see below | New/refined beyond the plan — the plan named this type but didn't specify its fields. |
| `EdgeBandPixels` | `{ data: Uint8ClampedArray; width: number; height: number }` | New — not in the plan's original contract list, but required to make `fitEdgeLine`'s `samples` parameter concrete. Single-channel grayscale, row-major, one byte per pixel. `data.length` must equal `width * height`. Deliberately a flat, transferable-friendly shape (one `Uint8ClampedArray`/`ArrayBuffer` + two numbers) since this is what a future Web Worker will receive via `postMessage`. |
| `Matrix3x3` | `readonly [readonly [n,n,n], readonly [n,n,n], readonly [n,n,n]]` | New — the plan left `computePerspectiveTransform`'s return type open ("a 3x3 matrix type ... your call"). Chose a plain row-major nested-array value over returning OpenCV.js's own `cv.Mat`, so callers get ordinary, inspectable, structured-clone-able data with no `cv.Mat.delete()` lifecycle to manage — `computePerspectiveTransform` allocates and frees all intermediate `cv.Mat`s internally. |

### `ToleranceConfig` (new/refined type — full definition)

```ts
interface ToleranceConfig {
  /** Fraction of the guide's corresponding dimension the card's true edge
   * may be shifted from the guide's edge (user mis-centering). Widens
   * expectedEdgeBands' bands perpendicular to each edge. */
  positionTolerance: number;

  /** Degrees the card may be rotated relative to the guide (user not
   * holding it square). Adds perpendicular slack to expectedEdgeBands'
   * bands so a rotated edge still fits inside its band across its length. */
  rotationToleranceDegrees: number;

  /** Fraction the card's apparent size may differ from the guide's size
   * (held nearer/farther than an exact fill). Combines with
   * positionTolerance to size expectedEdgeBands' band thickness. */
  zoomTolerance: number;

  /** Allowed fractional deviation of isQuadAspectRatioValid's measured aspect ratio
   * from targetAspectRatio before rejecting, e.g. 0.08 = +/-8%. */
  aspectRatioTolerance: number;
}
```

All four fields are dimensionless tuning knobs; no concrete values are
pinned in the module (per the plan's Open Questions #3 — needs empirical
tuning against real devices). Tests use an illustrative
`{ positionTolerance: 0.05, rotationToleranceDegrees: 5, zoomTolerance: 0.05,
aspectRatioTolerance: 0.08 }`.

## Constants (`src/core/constants.ts`)

| Constant | Value | Used by |
|---|---|---|
| `STANDARD_CARD_WIDTH_MM` / `STANDARD_CARD_HEIGHT_MM` | `63` / `88` | Documents the physical card model. |
| `STANDARD_CARD_ASPECT_RATIO` | `63/88 ≈ 0.7159` | `computeGuideGeometry`'s guide shape; the `targetAspectRatio` callers should pass to `isQuadAspectRatioValid` for the standard card orientation. |
| `GUIDE_FILL_FRACTION` | `0.92` | `computeGuideGeometry` — how much of the frame the guide fills. Judgment call (see file comment for reasoning). |
| `EDGE_BAND_CORNER_INSET_FRACTION` | `0.12` | `expectedEdgeBands` — fraction trimmed off each end of a band's length to stay clear of the card's rounded corners. |
| `EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD` | `20` | `fitEdgeLine`'s fail-fast check threshold (0-255 scale; see `fitEdgeLine` below for what's actually measured). |
| `EDGE_CANNY_LOW_THRESHOLD` / `EDGE_CANNY_HIGH_THRESHOLD` | `50` / `150` | `fitEdgeLine`'s `cv.Canny` call. |
| `EDGE_HOUGH_RHO` / `EDGE_HOUGH_THETA` | `1` / `π/180` | `fitEdgeLine`'s `cv.HoughLinesP` accumulator resolution. |
| `EDGE_HOUGH_VOTE_THRESHOLD` | `20` | `fitEdgeLine`'s `cv.HoughLinesP` vote threshold. |
| `EDGE_HOUGH_MIN_LINE_LENGTH_FRACTION` / `EDGE_HOUGH_MAX_LINE_GAP_FRACTION` | `0.3` / `0.05` | Fractions of the band's long-axis dimension, used as `cv.HoughLinesP`'s `minLineLength`/`maxLineGap`. |
| `EDGE_MIN_CONFIDENCE` | `0.25` | `fitEdgeLine` — below this, a fit is treated as not-found (returns `null`) rather than a usable weak line. |

All of the above are tuning knobs, deliberately grouped in one file so
they're easy to retune once real-device data is available, rather than
inlined in function bodies.

## Functions

### `computeGuideGeometry(camera: Orientation, frameSize: Size): GuideRect`

File: `src/core/guide.ts`

Computes the on-screen guide rectangle. The guide's shape is a pure function
of `camera` only (never of card print format) — portrait camera produces
`height > width`, landscape produces `width > height`, **unconditionally**,
regardless of `frameSize`'s own aspect ratio (verified this way in tests:
a portrait-camera guide is always taller than wide even when fed a wide or
square `frameSize`). The guide is centered in the frame
(`center = { x: frameSize.width/2, y: frameSize.height/2 }`) and sized to
fill as much of the frame as possible while respecting
`STANDARD_CARD_ASPECT_RATIO` and `GUIDE_FILL_FRACTION`, fitting entirely
within the frame regardless of which of `frameSize`'s two dimensions ends up
the binding constraint.

### `expectedEdgeBands(guide: GuideRect, tolerance: ToleranceConfig): [EdgeBand, EdgeBand, EdgeBand, EdgeBand]`

File: `src/core/guide.ts`

Returns the 4 search bands, in `[top, right, bottom, left]` order. Each
band's length (along its edge) is the guide's corresponding side length,
inset from both ends by `EDGE_BAND_CORNER_INSET_FRACTION` (stays clear of
the card's rounded corners). Each band's thickness (perpendicular to its
edge) is sized from `positionTolerance + zoomTolerance` (as a fraction of the
guide's corresponding dimension) plus the extra perpendicular drift a
rotated edge exhibits at the ends of its (inset) length, given
`rotationToleranceDegrees`. Opposite bands are symmetric around the guide's
center.

### `fitEdgeLine(cv: OpenCv, samples: EdgeBandPixels, outwardDirection: Point, rotationToleranceDegrees: number): FittedLine | null`

File: `src/core/edgeLine.ts`

`cv` is dependency-injected (not imported). Throws if `samples.data.length
!== width * height` (a caller bug); returns `null` ("edge not found") for a
band under 2px in either dimension (clamped at the frame boundary) and for
every step below that finds nothing. The steps are small private helpers:

1. `edgeScore` — fail fast unless scanlines cross a strong transition
   (average of per-scanline max gradients, better of rows/columns;
   threshold `EDGE_FAIL_FAST_MEAN_GRADIENT_THRESHOLD`).
2. `houghSegments` — `cv.Canny` + `cv.HoughLinesP` (length/gap scale with the
   band's long axis). This OpenCV.js build returns a 1-row Mat, so the
   segment count is `lines.total()`. All Mats are freed in a `finally`.
3. `filterByAngle` — drop segments more than `rotationToleranceDegrees` off
   the edge direction (perpendicular to the axis-aligned `outwardDirection`).
4. `outwardMostCluster` — walk segments outward → inward and stop at the
   first per-step gap above `EDGE_OUTWARD_GAP_TOLERANCE_FRACTION` of the band
   thickness, so an inner parallel feature (the card's printed border)
   doesn't pull the fit inward.
5. `fitWeightedLine` — length-weighted total-least-squares line through the
   kept segments' endpoints; confidence = linearity × coverage. Below
   `EDGE_MIN_CONFIDENCE` counts as not found.

`point`/`direction` are in band-local coordinates; callers translate by the
band's (clamped) `origin` before intersecting lines from different bands.

### `intersectLines(a: FittedLine, b: FittedLine): Point | null`

File: `src/core/geometry.ts`

Standard point+direction line-line intersection, sign-agnostic, both lines
in the same coordinate space. Returns `null` when the directions' cross
product is within `1e-9` of zero (parallel lines are an expected detection
outcome, not an error).

### `quadFromEdgeLines(lines: [FittedLine, FittedLine, FittedLine, FittedLine]): Quad | null`

File: `src/core/geometry.ts`

Intersects adjacent edge lines (`[top, right, bottom, left]`, frame
coordinates) into a `Quad`; `null` if any adjacent pair is parallel.

### `quadAspectRatio(corners: Quad): number`

File: `src/core/geometry.ts`

`min(avgWidth,avgHeight)/max(avgWidth,avgHeight)` from averaged opposite
side lengths; `NaN` for a degenerate quad. Shared by
`isQuadAspectRatioValid` and `selectBestFrame`.

### `isQuadAspectRatioValid(corners: Quad, targetAspectRatio: number, tolerance: ToleranceConfig): boolean`

File: `src/core/geometry.ts`

Whether `quadAspectRatio(corners)` is within
`tolerance.aspectRatioTolerance` (relative deviation) of
`targetAspectRatio`. A degenerate quad is invalid. Missing edges are the
caller's concern — it never sees an incomplete quad.

### `computePerspectiveTransform(cv: OpenCv, corners: [Point,Point,Point,Point], outputSize: Size): Matrix3x3`

File: `src/core/perspective.ts`

**Signature differs from the plan's sketch** for the same DI reason as
`fitEdgeLine` — `cv` added as the first parameter.

`corners` (assumed `[topLeft, topRight, bottomRight, bottomLeft]`) map
respectively onto `outputSize`'s `(0,0)`, `(width,0)`, `(width,height)`,
`(0,height)`. Internally calls `cv.getPerspectiveTransform` and reads its
`3x3`, `CV_64F` result into a plain `Matrix3x3`; all intermediate `cv.Mat`s
are freed before returning.

### `computeOutputRotationDegrees(camera: Orientation, card: CardOrientation): 0 | 90`

File: `src/core/orientation.ts`

Implementation: `return camera === card ? 0 : 90;`

- Match (both portrait or both landscape) → `0`.
- Mismatch → `90` for **both** mismatch directions (never other than `90` —
  the plan requires "always this direction", not "whichever is closer").

**This computes a correction rotation that presents the artwork upright**
(per the plan's UX flow step 6 — "the flattened image is rotated ... so the
artwork is presented upright"), relying on a documented precondition rather
than deriving it from pixels: the plan's **raw-capture placement
convention** (see `01-capture-and-detection.md`, "Orientation handling")
says that for a mismatched camera/card combo, the guide's on-screen
instructions always teach the user to physically place the card so its own
top edge faces the **left** of the camera's view — never "whichever is
closer" — so the raw flattened crop's top edge deterministically lands on
the left, not ambiguously left-or-right. That's a UX contract the shell is
responsible for enforcing (via guidance not yet built); this pure function
is entitled to assume it holds, not verify it. Given that precondition, the
correction is straightforward: rotate left → top, i.e. `90`.

This went through a documented back-and-forth worth noting for future
readers: an earlier draft of this function (and of the plan's own wording)
conflated two different things — the raw-capture placement target
("top-at-left", enforced during scanning) and this function's own output
target ("upright", i.e. correcting *away* from top-at-left) — and briefly
shipped with `270` (the "top→left" mapping, appropriate for the *placement*
convention, not the *correction* this function performs) before the plan
doc's own wording was fixed to disambiguate the two stages and this function
was corrected to `90` to match. The empirical rotation-math itself was never
in question at any point (see below) — only which of the two (inverse)
mappings the function was supposed to compute.

**Rotation-direction convention** (documented since the plan doesn't pin one
down): degrees are **clockwise**, matching Canvas 2D's `ctx.rotate()` and CSS
`transform: rotate()` — the rendering APIs this value is expected to
eventually feed, per the plan's "no UI framework" / vanilla-Canvas
constraint. Under that convention, a 90° rotation cycles edges
left→top→right→bottom→left; 270° is the inverse cycle. The target here is
left→top, i.e. `90`. This was verified empirically (not just derived
symbolically) with explicit pixel-array rotations — confirming 90° (not
270°) moves a marked left edge to the top, and separately (for the inverse
question) that 270° (not 90°) moves a marked top edge to the left — since
these are inverse questions and easy to conflate. The first check is also
encoded as a standing regression test in `orientation.test.ts`
("empirically rotates a mismatched combo's raw-convention left edge onto
the top (upright)").

Only ever returns `0` or `90` (the `180 | 270` members of the return type
exist because the plan's own signature declares them, for a future
disambiguation this phase doesn't attempt — see the plan's Orientation
Handling section: this function deliberately doesn't try to detect
upside-down vs. right-side-up beyond the one raw-capture-convention-derived
correction, only the guide/card category mismatch).

## Running this module's tests

```sh
npm test                 # runs the full Vitest suite once (all of src/core)
npm run test -- --watch  # watch mode
npx vitest run src/core/edgeLine.test.ts   # a single test file
```

No special setup is required beyond `npm install` — OpenCV.js is
initialized once per test *file* (not globally) via
`src/core/testSupport/openCv.ts`'s `loadOpenCv()`, called in a `beforeAll`
in `edgeLine.test.ts` and `perspective.test.ts` (the two suites that need a
real `cv` instance). That helper is test-only, not exported from `src/core`'s
public API, and loads `@techstark/opencv-js` via Node's `createRequire`
rather than a normal `import` — a static/dynamic ESM import of that package
crashes under Vitest's Node-side SSR transform specifically (`TypeError:
Method Promise.prototype.then called on incompatible receiver [object
Module]`; confirmed via an isolated repro — the package's export can itself
be a `Promise`, and Vitest's ESM-interop for that shape trips over it). This
doesn't affect `src/main.ts`, which imports the package normally and runs
fine under Vite's browser dev-server/build pipeline (per
[02-project-structure.md](./02-project-structure.md)) — it's specific to
Vitest's Node-side transform.

## Test coverage summary

- `orientation.test.ts` — full branch coverage of
  `computeOutputRotationDegrees` (all 4 enum combinations), an explicit check
  that both mismatch directions produce the same rotation, and an empirical
  regression test that actually rotates a synthetic pixel grid (representing
  the raw-capture-convention left edge) by the returned degrees and confirms
  it lands on the top edge — i.e. upright — not just asserting the numeric
  `90`.
- `geometry.test.ts` — `intersectLines`: perpendicular lines, non-unit
  direction vectors, sign-flipped directions, arbitrary angled lines,
  parallel and near-parallel lines (`null`). `quadFromEdgeLines`: rectangle
  reconstruction and parallel-edge `null`. `isQuadAspectRatioValid`: exact
  match, both guide orientations, small in-tolerance perturbation, two
  out-of-tolerance shapes, a degenerate (coincident-corner) quad, and a
  widened-tolerance acceptance case.
- `guide.test.ts` — `computeGuideGeometry`: orientation-shape invariant
  across wide/tall/square frames, exact aspect-ratio match, centering,
  fill-fraction behavior, and the "other dimension binds" fallback case.
  `expectedEdgeBands`: band/side order and labeling, band centered on the
  guide edge, corner inset (band shorter than the guide side), thickness
  grows with tolerance, and left-right/top-bottom symmetry around center.
- `edgeLine.test.ts` — `fitEdgeLine` against synthetic rendered bands with a
  known ground-truth point+direction: a vertical edge (tall/narrow band), a
  horizontal edge (short/wide band), a slightly rotated edge, an edge with a
  simulated occlusion gap (still recovered), a blank band (`null`), a
  low-contrast noisy band (`null`), too-thin band (`null`), malformed input (throws), and a relative
  check that full-visibility confidence exceeds mostly-occluded confidence.
  Uses the real OpenCV.js WASM build (via `loadOpenCv()`), not a mock.
- `perspective.test.ts` — `computePerspectiveTransform` against the real
  OpenCV.js build: an axis-aligned rectangle maps to the expected pure-scale
  transform, a skewed/perspective quad's corners map exactly onto the output
  rectangle's corners (round-tripped through the returned `Matrix3x3`), and a
  basic 3x3 shape check.

40 tests total, all passing (`npm test`).
