import type { GrayscalePixels } from "./types";

/** Otsu's threshold: the gray level that best splits the pixels in two;
 * pixels above it are the bright class. */
export function otsuThreshold({ data }: GrayscalePixels): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of data) {
    histogram[value]!++;
  }

  const total = data.length;
  const totalSum = histogram.reduce((sum, count, level) => sum + count * level, 0);

  let bestThreshold = 0;
  let bestVariance = -1;
  let darkCount = 0;
  let darkSum = 0;
  for (let level = 0; level < 256; level++) {
    darkCount += histogram[level]!;
    darkSum += histogram[level]! * level;
    const brightCount = total - darkCount;
    if (darkCount === 0 || brightCount === 0) {
      continue;
    }
    const darkMean = darkSum / darkCount;
    const brightMean = (totalSum - darkSum) / brightCount;
    const variance = darkCount * brightCount * (darkMean - brightMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = level;
    }
  }
  return bestThreshold;
}

/** Whether a text crop is light on dark: strokes cover less area than the
 * background, so the smaller Otsu class is the text. */
export function isLightTextOnDark(pixels: GrayscalePixels): boolean {
  const threshold = otsuThreshold(pixels);
  let brightCount = 0;
  for (const value of pixels.data) {
    if (value > threshold) {
      brightCount++;
    }
  }
  return brightCount < pixels.data.length / 2;
}
