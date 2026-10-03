# Phase 1 — Functional Core: API Reference

This document is the authoritative, as-built reference for everything
exported from `src/core`. It supersedes the sketch-level signatures in
[01-capture-and-detection.md](./01-capture-and-detection.md) ("Functional
core" / "Data contracts") wherever the two disagree — those sections were a
plan, this is what actually got built, including a few deliberate
refinements the plan left open. Later stages (the imperative shell in
`src/shell`) should treat this file, not
the original plan doc, as ground truth for `src/core`'s public API.

Everything below is exported from `src/core/index.ts` (a barrel re-exporting
every module in `src/core`), so `import { ... } from "../core"` (or the
equivalent relative path) gets all of it.

## Design notes that apply to the whole module

- **Pure, browser-free, side-effect-free.** No DOM, no camera, no module-level
  mutable state. Every function's output depends only on its inputs.
- **No image-processing library.** Edge fitting, the homography, perspective
  warps and OCR preprocessing are plain TypeScript over typed arrays.
  OpenCV.js was used until October 2026 and removed to avoid its 13 MB
  download; the pure versions measured as fast or faster on this app's
  workloads (per edge band: ~0.5 ms vs ~1.7 ms for Canny + Hough).
- **Corner order convention.** A `Quad` is always
  **[topLeft, topRight, bottomRight, bottomLeft]**, clockwise
  (`quadFromEdgeLines` produces it from `[top, right, bottom, left]` lines).
- **Edge-band tuple order.** `expectedEdgeBands` returns
  `[top, right, bottom, left]` (clockwise, starting at top).

## Types (`src/core/types.ts`)

| Type | Shape | Notes |
|---|---|---|
| `Orientation` | `"portrait" \| "landscape"` | Camera/guide orientation category. (The plan's snippets sometimes call this `CameraOrientation` — unified to one name, `Orientation`, matching the plan's own "Data contracts" section.) |
| `CardOrientation` | `"portrait" \| "landscape"` | User-selected print format of the physical card, independent of `Orientation`. |
| `Size` | `{ width: number; height: number }` | |
| `Point` | `{ x: number; y: number }` | |
| `GuideRect` | `{ center: Point; width: number; height: number; orientation: Orientation }` | |
| `EdgeBand` | `{ region: { origin: Point; size: Size }; side: "top"\|"right"\|"bottom"\|"left" }` | |
| `FittedLine` | `{ point: Point; direction: Point; confidence: number }` | `direction` is unit-length; sign is arbitrary. `confidence` is in `[0, 1]`. `point`/`direction` are in whatever coordinate space the input was in (band-local for `fitEdgeLine`'s output — see below). |
| `Quad` | `readonly [Point, Point, Point, Point]` | Quad corners in the order above. |
| `ToleranceConfig` | see below | New/refined beyond the plan — the plan named this type but didn't specify its fields. |
| `EdgeBandPixels` | `{ data: Uint8ClampedArray; width: number; height: number }` | New — not in the plan's original contract list, but required to make `fitEdgeLine`'s `samples` parameter concrete. Single-channel grayscale, row-major, one byte per pixel. `data.length` must equal `width * height`. A flat shape: one `Uint8ClampedArray` plus its size. |
| `Matrix3x3` | `readonly [readonly [n,n,n], readonly [n,n,n], readonly [n,n,n]]` | New — the plan left `computePerspectiveTransform`'s return type open ("a 3x3 matrix type ... your call"). A plain row-major nested-array value: ordinary, inspectable data. |

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
| `EDGE_POINT_MIN_GRADIENT` | `150` | `fitEdgeLine` — smallest Sobel gradient across a scanline that counts as an edge point (a clean step of ~38 gray levels; the old Canny high threshold). |
| `EDGE_LINE_MIN_SUPPORT_FRACTION` | `0.3` | `fitEdgeLine` — a candidate line needs edge points on this fraction of the scanlines where it lies inside the band. |
| `EDGE_INLIER_DISTANCE_PX` | `1.5` | `fitEdgeLine` — edge points within this distance of the chosen line are fitted. |
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

### `fitEdgeLine(samples: EdgeBandPixels, outwardDirection: Point, rotationToleranceDegrees: number): FittedLine | null`

File: `src/core/edgeLine.ts`

Throws if `samples.data.length !== width * height` (a caller bug); returns
`null` ("edge not found") for a band under 3px in either dimension (clamped
at the frame boundary) and whenever no line qualifies. The band is read as
scanlines across its edge (rows for a left/right band, columns for
top/bottom). The steps are small private helpers:

1. `edgePoints` — on each scanline, the local maxima of the Sobel gradient
   across the band (central difference, smoothed 1-2-1 over neighboring
   scanlines) of at least `EDGE_POINT_MIN_GRADIENT`, at sub-pixel precision.
2. `outwardMostLine` — every point votes for the lines through it whose
   angle is within `rotationToleranceDegrees` of the band's direction
   (a Hough transform restricted to plausible angles). Lines with enough
   support (see `EDGE_LINE_MIN_SUPPORT_FRACTION` and `EDGE_MIN_CONFIDENCE`)
   qualify; the outward-most one wins, so an inner parallel feature (the
   card's printed border) can't pull the fit inward.
3. `inliersOf` + `fitWeightedLine` — weighted total-least-squares line
   through the points within `EDGE_INLIER_DISTANCE_PX` of it; confidence =
   linearity × the fraction of scanlines covered. Below
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

### `computePerspectiveTransform(corners: Quad, outputSize: Size): Matrix3x3`

File: `src/core/perspective.ts`

`corners` (`[topLeft, topRight, bottomRight, bottomLeft]`) map respectively
onto `outputSize`'s `(0,0)`, `(width,0)`, `(width,height)`, `(0,height)`.
Solves the 8×8 linear system for the homography (Gaussian elimination with
partial pivoting); throws for a degenerate quad.

### `warpPerspective(source, sourceToOutput, outputSize, interpolation): RgbaPixelBuffer`

File: `src/core/warp.ts`

Warps an RGBA image by a homography, sampling the inverse-mapped position of
each output pixel (`invertMatrix3x3`, `src/core/regionWarp.ts`): bilinear
(the flattened card, display only) or bicubic with OpenCV's INTER_CUBIC
kernel (OCR regions). Positions outside the source are transparent.

### `prepareTextForOcr(rgba): { gray, inverted }` / `bilateralFilter(...)`

File: `src/core/ocrImage.ts`

A text crop for Tesseract: grayscale, inverted to dark-on-light when the
text is light on dark (`isLightTextOnDark`), then an edge-preserving
bilateral filter (`OCR_DENOISE_*` constants).

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

No special setup is required beyond `npm install`.

## Test coverage summary

Tests cover the business logic and the complex parts, not every function
(see each `*.test.ts` next to its module): edge fitting against synthetic
bands (vertical/horizontal, rotation tolerance, occlusion, confidence vs.
visible fraction, outward-most edge, noise), region warping, the homography,
the perspective warp, text-band analysis, OCR preparation, best-frame
selection, guide and band geometry, quad validation, and card matching.
