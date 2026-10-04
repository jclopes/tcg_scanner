import type { EdgeBandPixels, Point, Size } from "./types";

/** RGBA pixels, row-major, 4 bytes/pixel — `ImageData`'s shape without the
 * DOM dependency (and so convertible to one without copying). */
export interface RgbaPixelBuffer {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Rec. 601 luma: a pixel's gray level. */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** `region` rounded to whole pixels and clamped to a `size`d source (0 wide or
 * high where it lies outside). */
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

/** `region` of `source` as grayscale, rounded and clamped (see clampRegion);
 * `origin` is the clamped top-left, for translating band coordinates. */
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
      data[dstRowOffset + x] = Math.round(luma(r, g, b));
    }
  }

  return { data, width, height, origin: { x: x0, y: y0 } };
}

/** The RGBA pixels of `region` (rounded and clamped to `source`, see
 * clampRegion), copied out of `source`. */
export function cropRgba(source: RgbaPixelBuffer, region: { origin: Point; size: Size }): RgbaPixelBuffer {
  const { x0, y0, width, height } = clampRegion(region, source);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = ((y0 + y) * source.width + x0) * 4;
    data.set(source.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { data, width, height };
}
