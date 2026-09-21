// Shared data contracts for the functional core.
//
// Everything here is a plain, serializable-where-possible data shape — no
// classes, no methods, no hidden state. See docs/plan/01-capture-and-detection.md
// ("Data contracts") for the original spec and docs/plan/03-functional-core.md
// for the final, as-built API surface with rationale for anything added or
// refined beyond that original spec.

import type { CV } from "@techstark/opencv-js";

/**
 * An already-initialized OpenCV.js instance.
 *
 * Functions that need OpenCV.js primitives (fitEdgeLine, computePerspectiveTransform)
 * take this as an explicit parameter rather than importing/awaiting a global
 * singleton. This keeps src/core pure and trivially testable: a test (or the
 * real app shell) initializes OpenCV.js exactly once and passes the same
 * instance into every call. Aliased here (rather than spreading
 * `import type { CV }` across every module) so src/core's public API doesn't
 * leak which npm package provides OpenCV.js.
 */
export type OpenCv = CV;

/** Device/camera orientation category. Also used for the guide's shape, since
 * the guide's shape is a pure function of camera orientation only (see plan,
 * "Orientation handling"). */
export type Orientation = "portrait" | "landscape";

/** The physical card's print orientation, as selected by the user for the
 * session. Independent of camera/guide orientation. */
export type CardPrintFormat = "portrait" | "landscape";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface GuideRect {
  center: Point;
  width: number;
  height: number;
  orientation: Orientation;
}

export interface EdgeBand {
  /** The narrow region of the frame this edge is expected to fall within. */
  region: { origin: Point; size: Size };
  /** Which side of the guide this band corresponds to. */
  side: "top" | "right" | "bottom" | "left";
}

export interface FittedLine {
  /** A point the fitted line passes through (in the same coordinate space as
   * the input samples — e.g. band-local pixel coordinates for fitEdgeLine's
   * output; it's the caller's job to translate into frame coordinates using
   * the band's region.origin before calling intersectLines across bands). */
  point: Point;
  /** Unit-length direction vector of the line. Sign is arbitrary (the line
   * has no inherent "forward"). */
  direction: Point;
  /** Fit quality in [0, 1]. Higher is more confident. See fitEdgeLine's
   * documentation in 03-functional-core.md for exactly how this is derived. */
  confidence: number;
}

export interface QuadValidationResult {
  valid: boolean;
  corners: [Point, Point, Point, Point] | null;
  /**
   * "edge-not-found" is produced by the caller (the imperative shell), not by
   * validateQuad itself: validateQuad's `corners` parameter is a required,
   * already-computed [Point, Point, Point, Point], so a missing/unfittable
   * edge line has to be detected by the caller *before* corners can even be
   * intersected (it can't run intersectLines with a null FittedLine). The
   * shell is expected to short-circuit with { valid: false, corners: null,
   * reason: "edge-not-found" } as soon as any of the 4 fitEdgeLine results is
   * null, without calling validateQuad at all. This is a deliberate reading
   * of the plan's contract — flagged explicitly since the plan doesn't spell
   * it out.
   */
  reason?: "edge-not-found" | "aspect-ratio-out-of-tolerance";
}

export interface CaptureResult {
  image: ImageBitmap; // flattened, cropped, upright
  sourceResolution: Size; // resolution the crop was taken from
  usedHighResStill: boolean; // false if it fell back to the preview frame
}

/**
 * Tunable detection tolerances. Concrete values are deliberately not fixed
 * here (per the plan's Open Questions #3 — they need empirical tuning against
 * real devices/cameras), but the fields themselves are pinned down precisely
 * so fitEdgeLine and validateQuad have an explicit, testable contract.
 *
 * Used to size expectedEdgeBands' bands until EDGE_BAND_HALF_THICKNESS_PX /
 * EDGE_BAND_LENGTH_OVERHANG_PX replaced that with fixed pixel values (see
 * their doc comments in constants.ts) — this interface used to also carry
 * `positionTolerance` and `zoomTolerance` for that purpose. Removed rather
 * than left unused once nothing read them any more.
 */
export interface ToleranceConfig {
  /**
   * How far the card may be rotated relative to the guide, in degrees, due to
   * the user not holding it perfectly square. Used by fitEdgeLine's
   * angle-plausibility filter: a candidate edge segment whose angle deviates
   * from the band's expected (axis-aligned) direction by more than this is
   * rejected outright, on the assumption it belongs to something other than
   * the card's true edge.
   */
  rotationToleranceDegrees: number;

  /**
   * Allowed fractional deviation of the detected quad's measured aspect
   * ratio from the target aspect ratio before validateQuad rejects it, e.g.
   * 0.08 allows the measured short:long ratio to be off by up to 8% of the
   * target ratio.
   */
  aspectRatioTolerance: number;
}

/**
 * The pixel data a single edge band is fit against — not part of the plan's
 * original data-contract list, but required to make fitEdgeLine's `samples`
 * parameter concrete. Deliberately a plain, flat, transferable-friendly
 * structure (a Uint8ClampedArray backed by one ArrayBuffer, plus dimensions)
 * rather than an opaque object or an OpenCV Mat, since this is what a future
 * Web Worker will receive via postMessage (structured-clone/transfer of a
 * typed array's buffer is cheap; a Mat is not transferable).
 */
export interface EdgeBandPixels {
  /** Single-channel grayscale pixel data, row-major, one byte per pixel
   * (0-255). Length must equal width * height. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** This band's actual top-left origin in the source frame's coordinate
   * space — i.e. where (0,0) of `data` actually sits. Not necessarily equal
   * to the `EdgeBand.region.origin` that was requested: extractGrayscaleRegion
   * clamps a region that extends past the source's bounds (expected near the
   * frame's edges — see GUIDE_FILL_FRACTION's doc comment), and this is the
   * clamped value. Callers translating a fitted line's band-local point back
   * into frame coordinates must add *this* origin, not the requested one, or
   * every clamped band introduces a silent translation error. */
  origin: Point;
}

/**
 * A 3x3 transform matrix, row-major (m[row][col]), as produced by
 * computePerspectiveTransform. A plain nested-array value type was chosen
 * over returning OpenCV.js's own `cv.Mat` so the function's output is
 * ordinary, inspectable, structured-clone-able data with no manual
 * cv.Mat-lifecycle (`.delete()`) burden placed on the caller — the function
 * itself allocates and frees any intermediate Mats internally.
 */
export type Matrix3x3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
