import type { CardOrientation, PerEdge } from "../core";
import {
  ALL_FOUND_FLASH_EDGE_COLORS,
  clearGuideOverlay,
  DEFAULT_GUIDE_EDGE_COLORS,
  drawGuideOverlay,
  edgeColorsForDetection,
  GUIDE_ALL_FOUND_FLASH_DURATION_MS,
} from "./guideOverlay";
import type { EdgeColors } from "./guideOverlay";
import { orientationFromSize, videoFrameSize } from "./orientationWatcher";

type EdgesFound = PerEdge<boolean>;

/** The live guide over the video: edges colored by whether the latest frame
 * found them, all flashing white when all 4 first are. */
export class GuideFeedback {
  private lastEdgesFound: EdgesFound | null = null;
  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
    private readonly cardOrientation: () => CardOrientation,
  ) {}

  /** Draws the guide with no edges found yet. */
  start(): void {
    this.freeze();
    this.lastEdgesFound = null;
    this.draw(DEFAULT_GUIDE_EDGE_COLORS);
  }

  /** Repaints for a new frame's result. While the flash is up, frames don't
   * repaint; the flash's timeout repaints with the latest result. */
  update(edgesFound: EdgesFound): void {
    const previouslyAllFound = this.lastEdgesFound?.every(Boolean) ?? false;
    this.lastEdgesFound = edgesFound;

    if (edgesFound.every(Boolean) && !previouslyAllFound) {
      this.freeze();
      this.draw(ALL_FOUND_FLASH_EDGE_COLORS);
      this.flashTimeout = setTimeout(() => {
        this.flashTimeout = null;
        this.redraw();
      }, GUIDE_ALL_FOUND_FLASH_DURATION_MS);
      return;
    }
    if (this.flashTimeout === null) {
      this.draw(edgeColorsForDetection(edgesFound));
    }
  }

  /** Repaints with the latest result, e.g. after the video's size changed. */
  redraw(): void {
    this.draw(this.lastEdgesFound ? edgeColorsForDetection(this.lastEdgesFound) : DEFAULT_GUIDE_EDGE_COLORS);
  }

  /** Keeps the guide as drawn but stops the pending flash repaint. */
  freeze(): void {
    if (this.flashTimeout !== null) {
      clearTimeout(this.flashTimeout);
      this.flashTimeout = null;
    }
  }

  /** Removes the guide. */
  clear(): void {
    this.freeze();
    this.lastEdgesFound = null;
    clearGuideOverlay(this.canvas);
  }

  private draw(edgeColors: EdgeColors): void {
    const frameSize = videoFrameSize(this.video);
    drawGuideOverlay(this.canvas, orientationFromSize(frameSize), frameSize, edgeColors, this.cardOrientation());
  }
}
