import { quadAspectRatio } from "./geometry";
import { luma } from "./pixelExtraction";
import type { RgbaPixelBuffer } from "./pixelExtraction";
import type { Quad } from "./types";

/** Sharpness: variance of the grayscale Laplacian. Higher is sharper; 0 below
 * 3×3. */
export function laplacianVariance(frame: RgbaPixelBuffer): number {
  const { data, width, height } = frame;
  if (width < 3 || height < 3) {
    return 0;
  }

  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = luma(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
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

/** The candidate with the best sum of sharpness and card-shapedness, each
 * normalized across the candidates. Runs before flattening, so only the
 * winner is warped. `candidates` must be non-empty. */
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
