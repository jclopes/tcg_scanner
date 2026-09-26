import { quadAspectRatio } from "./geometry";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { Quad } from "./types";

/**
 * Sharpness estimate: variance of the grayscale image's discrete Laplacian
 * (kernel [[0,1,0],[1,-4,1],[0,1,0]]). Higher is sharper. 0 for images
 * smaller than 3x3.
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

/** A frame to score: its accepted quad plus the card's pixels in the raw
 * (unflattened) frame. */
export interface FrameCandidate {
  corners: Quad;
  cardPixels: RgbaPixelBuffer;
}

/**
 * Picks the best candidate by two signals, each normalized 0-1 against the
 * candidate set and summed with equal weight:
 * - sharpness: `laplacianVariance(cardPixels)`
 * - quad geometry: closeness of `quadAspectRatio(corners)` to `targetAspectRatio`
 *
 * Runs before flattening, so only the winner pays for the perspective warp.
 * `candidates` must be non-empty.
 */
export function selectBestFrame<T extends FrameCandidate>(candidates: readonly T[], targetAspectRatio: number): T {
  if (candidates.length === 0) {
    throw new Error("selectBestFrame requires at least one frame.");
  }
  if (candidates.length === 1) {
    return candidates[0]!;
  }

  const sharpness = candidates.map((candidate) => laplacianVariance(candidate.cardPixels));
  const aspectRatioError = candidates.map((candidate) =>
    Math.abs(quadAspectRatio(candidate.corners) - targetAspectRatio),
  );

  const maxSharpness = Math.max(...sharpness);
  const maxAspectRatioError = Math.max(...aspectRatioError);

  const scores = candidates.map((_, i) => {
    const sharpnessScore = maxSharpness > 0 ? sharpness[i]! / maxSharpness : 1;
    const aspectRatioScore = maxAspectRatioError > 0 ? 1 - aspectRatioError[i]! / maxAspectRatioError : 1;
    return sharpnessScore + aspectRatioScore;
  });

  const bestIndex = scores.reduce((best, score, i) => (score > scores[best]! ? i : best), 0);
  return candidates[bestIndex]!;
}
