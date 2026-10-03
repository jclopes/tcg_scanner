// Shared data contracts for the functional core — plain data shapes only.

/** Camera frame orientation; also the guide's shape. */
export type Orientation = "portrait" | "landscape";

/** The physical card's print orientation, as selected by the user. */
export type CardOrientation = "portrait" | "landscape";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One value per guide edge, in [top, right, bottom, left] order — the order
 * `expectedEdgeBands` returns. */
export type PerEdge<T> = readonly [T, T, T, T];

/** `edges` with `fn` applied to each, keeping the per-edge tuple type. */
export function mapEdges<T, U>(edges: PerEdge<T>, fn: (edge: T, index: number) => U): PerEdge<U> {
  return [fn(edges[0], 0), fn(edges[1], 1), fn(edges[2], 2), fn(edges[3], 3)];
}

/** Quad corners, always ordered [topLeft, topRight, bottomRight, bottomLeft]. */
export type Quad = readonly [Point, Point, Point, Point];

export interface GuideRect {
  center: Point;
  width: number;
  height: number;
}

export interface EdgeBand {
  /** The narrow region of the frame this edge is expected to fall within. */
  region: { origin: Point; size: Size };
  side: "top" | "right" | "bottom" | "left";
}

export interface FittedLine {
  /** A point on the line, in the coordinate space of the samples it was fit
   * against (band-local for `fitEdgeLine`). */
  point: Point;
  /** Unit direction vector; sign is arbitrary. */
  direction: Point;
  /** Fit quality in [0, 1]. */
  confidence: number;
}

export interface ToleranceConfig {
  /** Max card rotation relative to the guide, in degrees. `fitEdgeLine`
   * drops segments further off-angle than this. */
  rotationToleranceDegrees: number;
  /** Max relative deviation of a quad's aspect ratio from the target. */
  aspectRatioTolerance: number;
}

/** Grayscale pixels, 1 byte/pixel, row-major. */
export interface GrayscalePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One edge band's grayscale pixels. */
export interface EdgeBandPixels extends GrayscalePixels {
  /** Where `data`'s (0,0) sits in the source frame — the *clamped* origin,
   * which is what band-local coordinates must be translated by. */
  origin: Point;
}

/** A 3x3 row-major transform matrix. */
export type Matrix3x3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
