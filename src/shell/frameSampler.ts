import { extractGrayscaleRegion } from "../core";
import type { EdgeBand, EdgeBandPixels } from "../core";

/**
 * Reads pixels off a live `<video>` element and produces one grayscale
 * `EdgeBandPixels` per requested band — the impure half of "sample each
 * band's pixel region from the current video frame"; the actual
 * region-extraction + grayscale math is the pure `extractGrayscaleRegion`
 * helper in `src/core/pixelExtraction.ts`, called once per band below.
 *
 * Reuses one offscreen canvas across calls (resized only when the video's
 * dimensions change) rather than allocating a new canvas every frame.
 *
 * Implementation note: this draws the *entire* current video frame to the
 * offscreen canvas and reads it back with one `getImageData` call per
 * frame, then crops out each of the 4 bands from that single buffer, rather
 * than doing 4 separate smaller `getImageData` calls. Simpler (one canvas
 * read to reason about) and avoids 4x the per-call overhead; a full-frame
 * `getImageData` at preview resolution (see PREVIEW_STREAM_SIZE) is cheap
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
   * Samples all 4 of `bands`' pixel regions from `video`'s current frame,
   * in the same order they were given.
   */
  sampleBands(video: HTMLVideoElement, bands: readonly EdgeBand[]): EdgeBandPixels[] {
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.drawImage(video, 0, 0, width, height);
    const frame = this.ctx.getImageData(0, 0, width, height);

    return bands.map((band) =>
      extractGrayscaleRegion({ data: frame.data, width: frame.width, height: frame.height }, band.region),
    );
  }
}
