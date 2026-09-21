import type { RgbaPixelBuffer } from "./pixelExtraction";

/**
 * A sharpness estimate for an RGBA frame: the variance of its Laplacian — a
 * standard blur-detection measure. A sharp, in-focus image has a lot of
 * high-frequency edge content, which the Laplacian responds to strongly and
 * unevenly (high variance); a blurred image's response is small and flat
 * across the frame (low variance). Higher is sharper.
 *
 * Converts to grayscale first (same Rec. 601 luma weights as
 * extractGrayscaleRegion), then convolves with the standard discrete
 * Laplacian kernel `[[0,1,0],[1,-4,1],[0,1,0]]`. Plain array math, no
 * OpenCV.js dependency — cheap enough on an already-flattened card-sized
 * image not to need it, and keeping this cv-free is simpler to call and
 * test.
 */
export function laplacianVariance(frame: RgbaPixelBuffer): number {
  const { data, width, height } = frame;
  if (width < 3 || height < 3) {
    return 0;
  }

  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const innerWidth = width - 2;
  const innerHeight = height - 2;
  const responseCount = innerWidth * innerHeight;

  let sum = 0;
  const responses = new Float64Array(responseCount);
  let i = 0;
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOffset + x;
      const response = gray[idx - width]! + gray[idx + width]! + gray[idx - 1]! + gray[idx + 1]! - 4 * gray[idx]!;
      responses[i] = response;
      sum += response;
      i++;
    }
  }

  const mean = sum / responseCount;
  let squaredDeviationSum = 0;
  for (let j = 0; j < responseCount; j++) {
    const deviation = responses[j]! - mean;
    squaredDeviationSum += deviation * deviation;
  }
  return squaredDeviationSum / responseCount;
}

/**
 * Picks the best of several candidate frames — e.g. the burst
 * `captureFlattenedFrameBurst` (src/shell/flattenedFrameBurst.ts) captures
 * after a quad is first accepted — by combining two signals: sharpness
 * (`laplacianVariance`) and how closely the frame's own measured aspect
 * ratio matches `targetAspectRatio`. A frame that's sharp but badly cropped
 * (a wobbly detection on one burst frame) and a frame that's well-cropped
 * but blurry (motion blur mid-burst) are both bad picks, so neither signal
 * is used alone.
 *
 * Both signals are normalized against the candidate set (0-1, best in the
 * set scores 1) rather than compared in absolute units, which aren't
 * meaningfully comparable to each other, then summed with equal weight.
 *
 * `frames` must be non-empty.
 */
export function selectBestFrame<T extends RgbaPixelBuffer>(frames: readonly T[], targetAspectRatio: number): T {
  if (frames.length === 0) {
    throw new Error("selectBestFrame requires at least one frame.");
  }
  if (frames.length === 1) {
    return frames[0]!;
  }

  const sharpness = frames.map(laplacianVariance);
  const aspectRatioError = frames.map((frame) => {
    const measuredRatio = Math.min(frame.width, frame.height) / Math.max(frame.width, frame.height);
    return Math.abs(measuredRatio - targetAspectRatio);
  });

  const maxSharpness = Math.max(...sharpness);
  const maxAspectRatioError = Math.max(...aspectRatioError);

  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const sharpnessScore = maxSharpness > 0 ? sharpness[i]! / maxSharpness : 1;
    const aspectRatioScore = maxAspectRatioError > 0 ? 1 - aspectRatioError[i]! / maxAspectRatioError : 1;
    const score = sharpnessScore + aspectRatioScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return frames[bestIndex]!;
}
