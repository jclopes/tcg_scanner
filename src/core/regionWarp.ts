import { STANDARD_CARD_HEIGHT_MM, STANDARD_CARD_WIDTH_MM } from "./constants";
import type { RegionConfig } from "./identification";
import { computeOutputRotationDegrees } from "./orientation";
import type { CardOrientation, Matrix3x3, Orientation, Point, Size } from "./types";

/**
 * The single transform from camera-frame pixels to one region's output
 * pixels, so the region can be warped straight from the camera frame with one
 * interpolation. Applied right to left:
 * 1. `frameToCardMm`: camera frame → the card as it lies in the frame, in mm
 *    (`computePerspectiveTransform(corners, cardSizeMm(camera))`).
 * 2. Rotate upright (`computeOutputRotationDegrees`).
 * 3. Rotate the whole card by `region.rotationDeg` into its bounding box — the
 *    frame the region's mm box is measured in (see RegionConfig).
 * 4. Shift to the region's origin and scale to `pxPerMm`.
 */
export function regionWarpMatrix(
  frameToCardMm: Matrix3x3,
  camera: Orientation,
  cardOrientation: CardOrientation,
  region: RegionConfig,
  pxPerMm: number,
): Matrix3x3 {
  const inFrameSize = cardSizeMm(camera);
  const uprightSize = cardSizeMm(cardOrientation);
  const regionFrameSize = rotatedBoundingSize(uprightSize, region.rotationDeg ?? 0);

  return [
    scaling(pxPerMm),
    translation(-region.xMm, -region.yMm),
    rotationBetweenCenters(region.rotationDeg ?? 0, uprightSize, regionFrameSize),
    rotationBetweenCenters(computeOutputRotationDegrees(camera, cardOrientation), inFrameSize, uprightSize),
    frameToCardMm,
  ].reduce(multiplyMatrix3x3);
}

/** The region's output canvas size at `pxPerMm`. */
export function regionOutputSize(region: RegionConfig, pxPerMm: number): Size {
  return {
    width: Math.max(1, Math.round(region.widthMm * pxPerMm)),
    height: Math.max(1, Math.round(region.heightMm * pxPerMm)),
  };
}

/** The card's size in mm when it's oriented as `orientation` (portrait = the
 * short side horizontal). */
export function cardSizeMm(orientation: Orientation | CardOrientation): Size {
  return orientation === "portrait"
    ? { width: STANDARD_CARD_WIDTH_MM, height: STANDARD_CARD_HEIGHT_MM }
    : { width: STANDARD_CARD_HEIGHT_MM, height: STANDARD_CARD_WIDTH_MM };
}

/** `a · b` — the transform that applies `b` first, then `a`. */
function multiplyMatrix3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  const cell = (row: number, col: number): number =>
    a[row]![0]! * b[0]![col]! + a[row]![1]! * b[1]![col]! + a[row]![2]! * b[2]![col]!;
  return [
    [cell(0, 0), cell(0, 1), cell(0, 2)],
    [cell(1, 0), cell(1, 1), cell(1, 2)],
    [cell(2, 0), cell(2, 1), cell(2, 2)],
  ];
}

/** The inverse of `m`: the transform that undoes it. Throws if `m` is
 * singular. */
export function invertMatrix3x3(m: Matrix3x3): Matrix3x3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) {
    throw new Error("The transform is singular and can't be inverted.");
  }
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/** `point` transformed by the homography `m`. */
export function applyMatrix3x3(m: Matrix3x3, point: Point): Point {
  const [r0, r1, r2] = m;
  const w = r2[0] * point.x + r2[1] * point.y + r2[2];
  return {
    x: (r0[0] * point.x + r0[1] * point.y + r0[2]) / w,
    y: (r1[0] * point.x + r1[1] * point.y + r1[2]) / w,
  };
}

/** Axis-aligned bounding size of `size` rotated by `degrees`. */
function rotatedBoundingSize(size: Size, degrees: number): Size {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: size.width * cos + size.height * sin,
    height: size.width * sin + size.height * cos,
  };
}

/** Rotates clockwise (y down) by `degrees` around the center of a `fromSize`
 * area, landing centered in a `toSize` area — what drawing a rotated image
 * onto a resized canvas does. */
function rotationBetweenCenters(degrees: number, fromSize: Size, toSize: Size): Matrix3x3 {
  return [
    translation(toSize.width / 2, toSize.height / 2),
    rotationClockwise(degrees),
    translation(-fromSize.width / 2, -fromSize.height / 2),
  ].reduce(multiplyMatrix3x3);
}

function rotationClockwise(degrees: number): Matrix3x3 {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, -sin, 0],
    [sin, cos, 0],
    [0, 0, 1],
  ];
}

function translation(dx: number, dy: number): Matrix3x3 {
  return [
    [1, 0, dx],
    [0, 1, dy],
    [0, 0, 1],
  ];
}

function scaling(factor: number): Matrix3x3 {
  return [
    [factor, 0, 0],
    [0, factor, 0],
    [0, 0, 1],
  ];
}
