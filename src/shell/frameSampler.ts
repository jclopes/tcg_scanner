import { extractGrayscaleRegion } from "../core";
import type { EdgeBand, EdgeBandPixels, Size } from "../core";
import { require2dContext } from "./canvasUtils";

export interface SampledFrame {
  /** One grayscale band per requested band, in the same order. */
  bands: EdgeBandPixels[];
  /** The full frame the bands were cropped from. */
  frame: ImageData;
}

/**
 * Reads a frame off an image source (video, canvas, bitmap) with a single
 * full-frame `getImageData` and crops each band out of it as grayscale.
 * Reuses one offscreen canvas across calls.
 */
export class FrameSampler {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = require2dContext(this.canvas, { willReadFrequently: true });

  /** `size` must match `source`'s actual pixel dimensions. */
  sampleBands(source: CanvasImageSource, size: Size, bands: readonly EdgeBand[]): SampledFrame {
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }

    this.ctx.drawImage(source, 0, 0, size.width, size.height);
    const frame = this.ctx.getImageData(0, 0, size.width, size.height);

    return { bands: bands.map((band) => extractGrayscaleRegion(frame, band.region)), frame };
  }
}
