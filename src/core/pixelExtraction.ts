import type { EdgeBandPixels, Point, Size } from "./types";

/** RGBA pixels, row-major, 4 bytes/pixel — `ImageData`'s shape without the
 * DOM dependency. */
export interface RgbaPixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * `region` rounded to whole pixels and clamped to a `size`d source: its
 * clamped top-left and size (0 on an axis where the region lies entirely
 * outside the source).
 */
export function clampRegion(
  region: { origin: Point; size: Size },
  size: Size,
): { x0: number; y0: number; width: number; height: number } {
  const x0 = Math.max(0, Math.round(region.origin.x));
  const y0 = Math.max(0, Math.round(region.origin.y));
  const x1 = Math.min(size.width, Math.round(region.origin.x + region.size.width));
  const y1 = Math.min(size.height, Math.round(region.origin.y + region.size.height));
  return { x0, y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/**
 * Crops `region` out of `source` as grayscale (Rec. 601 luma, rounded).
 * The region is rounded to whole pixels and clamped to the source's bounds
 * (see clampRegion); the result's `origin` is the clamped top-left, which callers must use to
 * translate band-local coordinates. A region fully outside the source yields
 * a 0x0 band.
 */
export function extractGrayscaleRegion(
  source: RgbaPixelBuffer,
  region: { origin: Point; size: Size },
): EdgeBandPixels {
  const { x0, y0, width, height } = clampRegion(region, source);
  const data = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    const srcRowOffset = (y0 + y) * source.width;
    const dstRowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const srcIndex = (srcRowOffset + x0 + x) * 4;
      const r = source.data[srcIndex]!;
      const g = source.data[srcIndex + 1]!;
      const b = source.data[srcIndex + 2]!;
      data[dstRowOffset + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  return { data, width, height, origin: { x: x0, y: y0 } };
}
