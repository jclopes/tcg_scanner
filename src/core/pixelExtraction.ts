import type { EdgeBandPixels, Point, Size } from "./types";

/**
 * A plain RGBA pixel buffer, row-major, 4 bytes/pixel (0-255) — the same
 * shape a canvas 2D context's `ImageData.data` already has. Defined locally
 * (rather than depending on the DOM's `ImageData` type) so this module has
 * zero DOM dependency: any plain object with this shape works, whether it
 * comes from a live `<video>`/`<canvas>` (via the shell) or a synthetic
 * buffer built in a test.
 */
export interface RgbaPixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Extracts a rectangular region from an RGBA pixel buffer and converts it to
 * single-channel grayscale, producing the `EdgeBandPixels` shape
 * `fitEdgeLine` expects (see `types.ts`).
 *
 * This is plain array math with no DOM/canvas/video dependency once a pixel
 * buffer already exists, so it lives in `src/core` (pure, unit-testable)
 * rather than `src/shell` — per this project's rule that testable business
 * logic belongs in the functional core. The part that actually reads pixels
 * off a live `<video>`/`<canvas>` element (impure, needs the DOM) stays in
 * `src/shell` and calls this function with the resulting buffer.
 *
 * `region`'s `origin`/`size` may be fractional (guide/band geometry is
 * computed in continuous coordinates) — both are rounded to the nearest
 * pixel. The region may also extend partially or fully outside the source
 * buffer's bounds (e.g. a tolerance-widened band near the frame edge); it is
 * clamped to the source's actual pixel bounds, and the result's `origin` is
 * the *clamped* top-left corner, not necessarily `region.origin` — callers
 * must translate using the returned `origin`. A region that ends up with
 * zero width or height after clamping (including one entirely outside the
 * source) returns a degenerate `{ width: 0, height: 0, data: new
 * Uint8ClampedArray(0), origin }` — callers don't need a special case for
 * this, since `fitEdgeLine` already treats any band with
 * `width < 2 || height < 2` as "not found" (returns `null`).
 *
 * Grayscale conversion uses the standard Rec. 601 luma weights
 * (0.299 R + 0.587 G + 0.114 B), ignoring alpha, rounded to the nearest
 * integer.
 */
export function extractGrayscaleRegion(
  source: RgbaPixelBuffer,
  region: { origin: Point; size: Size },
): EdgeBandPixels {
  const x0 = Math.max(0, Math.round(region.origin.x));
  const y0 = Math.max(0, Math.round(region.origin.y));
  const x1 = Math.min(source.width, Math.round(region.origin.x + region.size.width));
  const y1 = Math.min(source.height, Math.round(region.origin.y + region.size.height));

  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);

  const data = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y++) {
    const srcRowOffset = (y0 + y) * source.width;
    const dstRowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const srcIndex = (srcRowOffset + x0 + x) * 4;
      const r = source.data[srcIndex] ?? 0;
      const g = source.data[srcIndex + 1] ?? 0;
      const b = source.data[srcIndex + 2] ?? 0;
      data[dstRowOffset + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  return { data, width, height, origin: { x: x0, y: y0 } };
}
