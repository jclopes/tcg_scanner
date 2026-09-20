import type { Matrix3x3, OpenCv, Point, Size } from "./types";

/**
 * Computes the 3x3 perspective transform matrix that maps the detected quad
 * corners onto an axis-aligned rectangle of `outputSize`, for flattening the
 * card crop.
 *
 * Corner order: `corners` is assumed to be
 * [topLeft, topRight, bottomRight, bottomLeft] (clockwise), matching
 * validateQuad's assumed order. They map respectively onto
 * outputSize's (0,0), (width,0), (width,height), (0,height).
 *
 * Takes the already-initialized OpenCV.js instance explicitly (dependency
 * injection — see OpenCv's doc comment in types.ts). Internally allocates
 * OpenCV.js Mats to call cv.getPerspectiveTransform, but frees them all
 * before returning, so the caller only ever deals with a plain numeric
 * Matrix3x3 value — no cv.Mat lifecycle leaks out of this function.
 */
export function computePerspectiveTransform(
  cv: OpenCv,
  corners: [Point, Point, Point, Point],
  outputSize: Size,
): Matrix3x3 {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;

  const srcData = [
    topLeft.x, topLeft.y,
    topRight.x, topRight.y,
    bottomRight.x, bottomRight.y,
    bottomLeft.x, bottomLeft.y,
  ];
  const dstData = [
    0, 0,
    outputSize.width, 0,
    outputSize.width, outputSize.height,
    0, outputSize.height,
  ];

  const src = cv.matFromArray(4, 1, cv.CV_32FC2, srcData);
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, dstData);
  let transform: ReturnType<OpenCv["getPerspectiveTransform"]> | undefined;
  try {
    transform = cv.getPerspectiveTransform(src, dst);
    const m = transform.data64F;
    return [
      [m[0]!, m[1]!, m[2]!],
      [m[3]!, m[4]!, m[5]!],
      [m[6]!, m[7]!, m[8]!],
    ];
  } finally {
    src.delete();
    dst.delete();
    transform?.delete();
  }
}
