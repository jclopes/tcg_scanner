import {
  STANDARD_CARD_ASPECT_RATIO,
  computeGuideGeometry,
  expectedEdgeBands,
  intersectLines,
  validateQuad,
} from "../core";
import type { EdgeBand, EdgeBandPixels, FittedLine, Point, Size } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { DEFAULT_TOLERANCE_CONFIG } from "./config";
import { FrameSampler } from "./frameSampler";
import { getVideoOrientation } from "./orientationWatcher";

export interface DetectionLoopResult {
  /** The accepted quad's 4 corners, in preview-frame pixel coordinates
   * (i.e. `video.videoWidth`/`videoHeight` space at the moment of
   * acceptance) — [topLeft, topRight, bottomRight, bottomLeft], per
   * src/core's corner-order convention. */
  corners: [Point, Point, Point, Point];
  /** The preview frame's size at the moment of acceptance — the coordinate
   * space `corners` is expressed in. The final capture step needs this to
   * rescale onto whatever image source it ends up using. */
  frameSize: Size;
}

/**
 * Runs the live per-frame detection loop described in the plan's
 * "Detection strategy": each evaluated frame, compute the guide + its 4
 * edge bands for the video's *current* orientation, sample each band's
 * pixels, run all 4 edges in parallel through the worker pool, and — if all
 * 4 fit and the resulting quad validates against the target aspect ratio —
 * resolve with the accepted quad's corners and stop. Any other outcome
 * (a missing edge, a quad that fails validation, or even a transient
 * detection error) discards the frame and continues — per the plan's
 * fail-fast requirement, a bad frame must never block or visibly stall the
 * live preview.
 *
 * Frame scheduling: uses `requestVideoFrameCallback` when available (ties
 * evaluation to actual new camera frames rather than the display's refresh
 * rate — the more correct choice for a camera feed), falling back to
 * `requestAnimationFrame` when it isn't (e.g. older Safari).
 * `requestVideoFrameCallback` fires once per call and must be re-requested
 * for the next frame, which is why `start()`'s callback re-schedules itself
 * after each evaluated frame rather than being a single persistent
 * subscription.
 */
export class DetectionLoop {
  private readonly sampler = new FrameSampler();
  private handle: number | null = null;
  private stopped = true;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly pool: EdgeDetectionPool,
  ) {}

  /** Starts the loop. `onAccepted` is called (and the loop stopped) as soon
   * as one frame's quad validates. */
  start(onAccepted: (result: DetectionLoopResult) => void): void {
    this.stopped = false;

    const step = (): void => {
      if (this.stopped) return;
      this.evaluateFrame()
        .then((result) => {
          if (this.stopped) return;
          if (result) {
            this.stop();
            onAccepted(result);
          } else {
            this.scheduleNext(step);
          }
        })
        .catch((error: unknown) => {
          // A single frame's detection failing (e.g. a transient worker
          // rejection) must not kill the live loop. Log and keep going.
          console.error("Frame evaluation failed; continuing scan loop.", error);
          if (!this.stopped) this.scheduleNext(step);
        });
    };

    this.scheduleNext(step);
  }

  /** Stops the loop. Safe to call even if it's already stopped. */
  stop(): void {
    this.stopped = true;
    if (this.handle !== null) {
      if (typeof this.video.cancelVideoFrameCallback === "function") {
        this.video.cancelVideoFrameCallback(this.handle);
      } else {
        cancelAnimationFrame(this.handle);
      }
      this.handle = null;
    }
  }

  private scheduleNext(step: () => void): void {
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.handle = this.video.requestVideoFrameCallback(step);
    } else {
      this.handle = requestAnimationFrame(step);
    }
  }

  private async evaluateFrame(): Promise<DetectionLoopResult | null> {
    const { videoWidth, videoHeight } = this.video;
    if (videoWidth === 0 || videoHeight === 0) {
      return null;
    }

    const frameSize: Size = { width: videoWidth, height: videoHeight };
    const orientation = getVideoOrientation(this.video);
    const guide = computeGuideGeometry(orientation, frameSize);
    const bands = expectedEdgeBands(guide, DEFAULT_TOLERANCE_CONFIG);
    const [topPixels, rightPixels, bottomPixels, leftPixels] = this.sampler.sampleBands(
      this.video,
      bands,
    ) as [EdgeBandPixels, EdgeBandPixels, EdgeBandPixels, EdgeBandPixels];

    const [topLine, rightLine, bottomLine, leftLine] = await this.pool.detectEdges([
      topPixels,
      rightPixels,
      bottomPixels,
      leftPixels,
    ]);

    // Per src/core's documented contract (QuadValidationResult's doc
    // comment in types.ts), a missing edge is the caller's responsibility
    // to short-circuit on — validateQuad is never called with one.
    if (!topLine || !rightLine || !bottomLine || !leftLine) {
      return null;
    }

    const [topBand, rightBand, bottomBand, leftBand] = bands;
    const top = toFrameCoordinates(topLine, topBand);
    const right = toFrameCoordinates(rightLine, rightBand);
    const bottom = toFrameCoordinates(bottomLine, bottomBand);
    const left = toFrameCoordinates(leftLine, leftBand);

    let corners: [Point, Point, Point, Point];
    try {
      corners = [
        intersectLines(top, left), // topLeft
        intersectLines(top, right), // topRight
        intersectLines(bottom, right), // bottomRight
        intersectLines(bottom, left), // bottomLeft
      ];
    } catch {
      // intersectLines throws on (near-)parallel adjacent edges — a
      // genuine per-frame detection failure, not a bug. Discard the frame.
      return null;
    }

    const validation = validateQuad(corners, STANDARD_CARD_ASPECT_RATIO, DEFAULT_TOLERANCE_CONFIG);
    if (!validation.valid || !validation.corners) {
      return null;
    }

    return { corners: validation.corners, frameSize };
  }
}

/** Translates a band-local FittedLine (as fitEdgeLine/the worker pool
 * produce it) into frame coordinates by adding the band's region.origin —
 * per FittedLine's doc comment, required before intersecting lines from two
 * different bands. */
function toFrameCoordinates(line: FittedLine, band: EdgeBand): FittedLine {
  return {
    ...line,
    point: {
      x: line.point.x + band.region.origin.x,
      y: line.point.y + band.region.origin.y,
    },
  };
}
