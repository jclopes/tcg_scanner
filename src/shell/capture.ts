import { computeOutputRotationDegrees, computePerspectiveTransform } from "../core";
import type { CardPrintFormat, OpenCv, Orientation, Point } from "../core";

export interface CaptureInput {
  cv: OpenCv;
  /** The exact frame the quad was detected in — DetectionLoopResult's
   * `frameCanvas`. Warped directly, with no new frame captured here, so
   * every step of a scan (edge detection, the quad overlay, the flattened
   * output) reflects the same frame. */
  frameCanvas: HTMLCanvasElement;
  /** The accepted quad's corners, in `frameCanvas`'s own pixel coordinates. */
  corners: [Point, Point, Point, Point];
  camera: Orientation;
  cardFormat: CardPrintFormat;
}

export interface CaptureOutput {
  /** The final flattened, cropped, upright card image. */
  canvas: HTMLCanvasElement;
  /** Same object as `CaptureInput.frameCanvas` — exposed so a debug
   * quad-overlay can be drawn on the exact frame `canvas` was warped from. */
  sourceCanvas: HTMLCanvasElement;
}

/**
 * Runs the plan's capture step (UX flow steps 5-6): flattens/crops the
 * accepted frame via a perspective warp and rotates the result upright.
 *
 * Applying the warp with OpenCV.js's `cv.warpPerspective` (rather than
 * plain canvas transform math) was the judgment call here: `src/core`
 * already produces the transform via `cv.getPerspectiveTransform`
 * (computePerspectiveTransform), and a true perspective warp isn't
 * expressible with the CSS/Canvas 2D transform primitives (`ctx.transform`
 * only does affine transforms — no perspective/projective term) without
 * hand-rolling per-pixel remapping. Reusing OpenCV.js here keeps the one
 * CV dependency the project already has and avoids reimplementing
 * `warpPerspective` badly by hand.
 */
export async function captureFlattenedCard(input: CaptureInput): Promise<CaptureOutput> {
  const { cv, frameCanvas, corners, camera, cardFormat } = input;

  const [topLeft, topRight, , bottomLeft] = corners;
  // Output pixel size = the quad's own measured side lengths in the source
  // frame (rounded), rather than a fixed constant — this preserves as much
  // of the captured resolution as the source frame actually has, matching
  // the plan's "maximum-resolution image of just that card" goal, instead
  // of down/up-sampling to an arbitrary fixed output size.
  const outputWidth = Math.max(2, Math.round(distance(topLeft, topRight)));
  const outputHeight = Math.max(2, Math.round(distance(topLeft, bottomLeft)));

  const matrix = computePerspectiveTransform(cv, corners, {
    width: outputWidth,
    height: outputHeight,
  });

  const flatCanvas = document.createElement("canvas");
  flatCanvas.width = outputWidth;
  flatCanvas.height = outputHeight;

  const srcMat = cv.imread(frameCanvas);
  const warped = new cv.Mat();
  // Flatten the row-major Matrix3x3 into the plain number[] matFromArray
  // expects.
  const flatMatrixData = matrix.flat() as number[];
  const transformMat = cv.matFromArray(3, 3, cv.CV_64F, flatMatrixData);
  try {
    cv.warpPerspective(srcMat, warped, transformMat, new cv.Size(outputWidth, outputHeight));
    cv.imshow(flatCanvas, warped);
  } finally {
    srcMat.delete();
    warped.delete();
    transformMat.delete();
  }

  const rotationDegrees = computeOutputRotationDegrees(camera, cardFormat);
  const canvas = rotateCanvas(flatCanvas, rotationDegrees);

  return { canvas, sourceCanvas: frameCanvas };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Rotates `source` clockwise by `degrees` (matching
 * computeOutputRotationDegrees' documented rotation-direction convention)
 * onto a freshly-sized canvas, swapping width/height for 90/270. */
function rotateCanvas(source: HTMLCanvasElement, degrees: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (degrees === 0) {
    return source;
  }

  const swapDimensions = degrees === 90 || degrees === 270;
  const output = document.createElement("canvas");
  output.width = swapDimensions ? source.height : source.width;
  output.height = swapDimensions ? source.width : source.height;

  const ctx = output.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to rotate the capture.");
  }
  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}
