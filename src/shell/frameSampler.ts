import { extractGrayscaleRegion } from "../core";
import type { EdgeBand, EdgeBandPixels, Size } from "../core";

export interface SampledFrame {
  /** One grayscale `EdgeBandPixels` per requested band, in the same order. */
  bands: EdgeBandPixels[];
  /** The full frame the bands were cropped from — returned alongside them
   * (at no extra cost, since it's already read below) so a caller that
   * accepts this frame can reuse the exact same pixels for later pipeline
   * steps instead of capturing a new one. */
  frame: ImageData;
}

/**
 * Reads pixels off an image source — a live `<video>` element, or a still
 * (canvas/bitmap) — and produces one grayscale `EdgeBandPixels` per
 * requested band. The impure half of "sample each band's pixel region from
 * the current frame"; the actual region-extraction + grayscale math is the
 * pure `extractGrayscaleRegion` helper in `src/core/pixelExtraction.ts`,
 * called once per band below.
 *
 * Reuses one offscreen canvas across calls (resized only when `size`
 * changes) rather than allocating a new canvas every call.
 *
 * Implementation note: this draws the *entire* source frame to the
 * offscreen canvas and reads it back with one `getImageData` call, then
 * crops out each of the 4 bands from that single buffer, rather than doing
 * 4 separate smaller `getImageData` calls. Simpler (one canvas read to
 * reason about) and avoids 4x the per-call overhead; a full-frame
 * `getImageData` at preview resolution (see CAMERA_RESOLUTION_OPTIONS in
 * config.ts) is cheap
 * enough for this to not be a bottleneck relative to the Canny/HoughLinesP
 * work happening per band regardless. Revisit if real-device profiling
 * says otherwise.
 */
export class FrameSampler {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Could not get a 2D canvas context for frame sampling.");
    }
    this.ctx = ctx;
  }

  /**
   * Samples all 4 of `bands`' pixel regions from `source`'s current frame
   * (`size` must match `source`'s actual pixel dimensions), in the same
   * order they were given.
   */
  sampleBands(source: CanvasImageSource, size: Size, bands: readonly EdgeBand[]): SampledFrame {
    const { width, height } = size;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.drawImage(source, 0, 0, width, height);
    const frame = this.ctx.getImageData(0, 0, width, height);

    const bandPixels = bands.map((band) =>
      extractGrayscaleRegion({ data: frame.data, width: frame.width, height: frame.height }, band.region),
    );
    return { bands: bandPixels, frame };
  }
}
