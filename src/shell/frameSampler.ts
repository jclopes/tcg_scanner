import { clampRegion, extractGrayscaleRegion, mapEdges } from "../core";
import type { EdgeBand, EdgeBandPixels, PerEdge, Size } from "../core";
import { require2dContext, snapshotSource } from "./canvasUtils";

/**
 * Draws a frame off an image source (video, canvas, bitmap) into one reused
 * offscreen canvas and reads back only the edge bands, as grayscale — not the
 * whole frame, which is several times more pixels than the four thin bands.
 */
export class FrameSampler {
  private readonly canvas = document.createElement("canvas");
  private readonly ctx = require2dContext(this.canvas, { willReadFrequently: true });

  /** One grayscale band per requested band, in the same order. `size` must
   * match `source`'s actual pixel dimensions. */
  sampleBands(source: CanvasImageSource, size: Size, bands: PerEdge<EdgeBand>): PerEdge<EdgeBandPixels> {
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    this.ctx.drawImage(source, 0, 0, size.width, size.height);
    return mapEdges(bands, (band) => this.readBand(band.region, size));
  }

  /** A copy of the frame last drawn by `sampleBands` — valid until the next
   * `sampleBands` call, so a caller must take it before sampling again. */
  snapshotFrame(): HTMLCanvasElement {
    return snapshotSource(this.canvas, { width: this.canvas.width, height: this.canvas.height });
  }

  /** The band's pixels, clamped to the frame. A band entirely outside the
   * frame is empty (`getImageData` rejects a zero-sized rect). */
  private readBand(region: EdgeBand["region"], size: Size): EdgeBandPixels {
    const { x0, y0, width, height } = clampRegion(region, size);
    const origin = { x: x0, y: y0 };
    if (width === 0 || height === 0) {
      return { data: new Uint8ClampedArray(0), width, height, origin };
    }
    const pixels = this.ctx.getImageData(x0, y0, width, height);
    const band = extractGrayscaleRegion(pixels, { origin: { x: 0, y: 0 }, size: { width, height } });
    return { ...band, origin };
  }
}
