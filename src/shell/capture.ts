import { computeOutputRotationDegrees, computePerspectiveTransform } from "../core";
import type { CardPrintFormat, OpenCv, Orientation, Point, Size } from "../core";

export interface CaptureInput {
  cv: OpenCv;
  video: HTMLVideoElement;
  /** The accepted quad's corners, in the coordinate space of
   * `previewFrameSize` (i.e. as produced by DetectionLoop). */
  previewCorners: [Point, Point, Point, Point];
  previewFrameSize: Size;
  camera: Orientation;
  cardFormat: CardPrintFormat;
}

export interface CaptureOutput {
  /** The final flattened, cropped, upright card image. */
  canvas: HTMLCanvasElement;
  usedHighResStill: boolean;
  sourceResolution: Size;
}

/**
 * Runs the plan's capture step (UX flow steps 5-6): grabs the best
 * available still image, rescales the detected quad's corners onto it,
 * flattens/crops via a perspective warp, and rotates the result upright.
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
  const { cv, video, previewCorners, previewFrameSize, camera, cardFormat } = input;

  const { bitmap, usedHighResStill } = await captureStillImage(video);
  const sourceResolution: Size = { width: bitmap.width, height: bitmap.height };

  // The still may have different pixel dimensions than the preview frame
  // the quad was detected in (e.g. ImageCapture.takePhoto() returning a
  // full-sensor-resolution photo) — rescale the corners by the ratio
  // between the two coordinate spaces before doing anything else with them
  // (per the plan's "Device & resolution handling").
  const scaleX = sourceResolution.width / previewFrameSize.width;
  const scaleY = sourceResolution.height / previewFrameSize.height;
  const scaledCorners = previewCorners.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) as [
    Point,
    Point,
    Point,
    Point,
  ];

  const [topLeft, topRight, , bottomLeft] = scaledCorners;
  // Output pixel size = the quad's own measured side lengths in the source
  // image (rounded), rather than a fixed constant — this preserves as much
  // of the captured resolution as the source image actually has, matching
  // the plan's "maximum-resolution image of just that card" goal, instead
  // of down/up-sampling to an arbitrary fixed output size.
  const outputWidth = Math.max(2, Math.round(distance(topLeft, topRight)));
  const outputHeight = Math.max(2, Math.round(distance(topLeft, bottomLeft)));

  const matrix = computePerspectiveTransform(cv, scaledCorners, {
    width: outputWidth,
    height: outputHeight,
  });

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = sourceResolution.width;
  sourceCanvas.height = sourceResolution.height;
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) {
    throw new Error("Could not get a 2D canvas context for the capture source.");
  }
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const flatCanvas = document.createElement("canvas");
  flatCanvas.width = outputWidth;
  flatCanvas.height = outputHeight;

  const srcMat = cv.imread(sourceCanvas);
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

  return { canvas, usedHighResStill, sourceResolution };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Attempts a high-resolution still via `ImageCapture.takePhoto()` (a real
 * full-resolution photo capture, where supported), falling back to
 * `grabFrame()` (a snapshot of the live video track, still often
 * higher-res than the negotiated preview stream), and finally to just
 * drawing the current `<video>` frame if `ImageCapture` isn't supported at
 * all or both calls fail — per the plan's "Device & resolution handling"
 * (notably some desktop webcam/browser combinations lack `ImageCapture`
 * support entirely).
 */
async function captureStillImage(
  video: HTMLVideoElement,
): Promise<{ bitmap: ImageBitmap; usedHighResStill: boolean }> {
  const stream = video.srcObject;
  if (typeof ImageCapture !== "undefined" && stream instanceof MediaStream) {
    const [track] = stream.getVideoTracks();
    if (track) {
      const imageCapture = new ImageCapture(track);
      try {
        const blob = await imageCapture.takePhoto();
        return { bitmap: await createImageBitmap(blob), usedHighResStill: true };
      } catch (error) {
        console.warn("ImageCapture.takePhoto() failed, trying grabFrame().", error);
      }
      try {
        return { bitmap: await imageCapture.grabFrame(), usedHighResStill: true };
      } catch (error) {
        console.warn("ImageCapture.grabFrame() failed, falling back to the live video frame.", error);
      }
    }
  }

  const fallbackCanvas = document.createElement("canvas");
  fallbackCanvas.width = video.videoWidth;
  fallbackCanvas.height = video.videoHeight;
  const ctx = fallbackCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context for the capture fallback.");
  }
  ctx.drawImage(video, 0, 0);
  return { bitmap: await createImageBitmap(fallbackCanvas), usedHighResStill: false };
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
