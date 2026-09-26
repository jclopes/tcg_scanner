import type { Matrix3x3, OpenCv, Quad, Size } from "./types";

/**
 * The perspective transform mapping `corners` onto an axis-aligned
 * `outputSize` rectangle ((0,0), (w,0), (w,h), (0,h), in corner order).
 * Frees every OpenCV Mat it allocates; returns plain numbers.
 */
export function computePerspectiveTransform(
  cv: OpenCv,
  corners: Quad,
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
