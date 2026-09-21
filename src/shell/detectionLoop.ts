import type { Point, Size } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { evaluateFrameForQuad } from "./frameDetection";
import type { RawEdgeDetection } from "./frameDetection";
import { FrameSampler } from "./frameSampler";

export interface DetectionLoopResult {
  /** The accepted quad's 4 corners, in `frameCanvas`'s pixel coordinates —
   * [topLeft, topRight, bottomRight, bottomLeft], per src/core's
   * corner-order convention. */
  corners: [Point, Point, Point, Point];
  /** The preview frame's size at the moment of acceptance — the coordinate
   * space `corners` (and `frameCanvas`) are expressed in. */
  frameSize: Size;
  /** A snapshot of the exact frame `corners` was computed from. The capture
   * step must warp *this* canvas rather than grabbing a new frame off the
   * video — capturing an additional frame after acceptance would mean the
   * flattened output (and any debug imagery) no longer matches what was
   * actually detected. */
  frameCanvas: HTMLCanvasElement;
  /** Only present when the loop was constructed with `debug: true`. See
   * `RawEdgeDetection`'s doc comment for what's captured and why. */
  debug?: RawEdgeDetection;
}

/** A one-off diagnostic snapshot of a single evaluated frame's edge-band
 * detection, regardless of whether that frame was accepted — see
 * `DetectionLoop.requestForcedDebugCapture`. Same shape as
 * `DetectionLoopResult.debug`: `lines` may contain `null`s, since
 * fitEdgeLine not finding an edge is exactly the kind of thing this is for
 * diagnosing. */
export type ForcedDebugSnapshot = RawEdgeDetection;

/**
 * Runs the live per-frame detection loop described in the plan's
 * "Detection strategy": each evaluated frame, run `evaluateFrameForQuad`
 * (src/shell/frameDetection.ts) against the video's *current* frame, and —
 * if it accepts a quad — resolve with the result and stop. Any other
 * outcome (a missing edge, a quad that fails validation, or even a
 * transient detection error) discards the frame and continues — per the
 * plan's fail-fast requirement, a bad frame must never block or visibly
 * stall the live preview.
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
  private forcedDebugCallback: ((snapshot: ForcedDebugSnapshot) => void) | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly pool: EdgeDetectionPool,
    /** When true, `evaluateFrame` pays the extra cost (per evaluated frame,
     * not just the eventually-accepted one) of cloning each sampled band's
     * pixels so an accepted result can carry them for the debug feature. */
    private readonly debug: boolean = false,
  ) {}

  /**
   * Starts the loop. `onAccepted` is called (and the loop stopped) as soon
   * as one frame's quad validates. `onFrameEvaluated`, when given, is
   * called after *every* evaluated frame (accepted or not, including ones
   * an evaluation error skipped) with that frame's per-edge found/not-found
   * status ([top, right, bottom, left]) — driving the live guide overlay's
   * per-edge color feedback (see app.ts), which needs to know about every
   * frame's result, not just an eventual acceptance.
   */
  start(
    onAccepted: (result: DetectionLoopResult) => void,
    onFrameEvaluated?: (edgesFound: [boolean, boolean, boolean, boolean]) => void,
  ): void {
    this.stopped = false;

    const step = (): void => {
      if (this.stopped) return;
      this.evaluateFrame()
        .then(({ result, edgesFound }) => {
          if (this.stopped) return;
          onFrameEvaluated?.(edgesFound);
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

  /**
   * Arms a one-shot request: the *next* frame this loop evaluates —
   * whichever one that turns out to be, whether it ends up accepted,
   * rejected, or errors out — invokes `callback` with that frame's sampled
   * bands and per-edge fitted lines (each `null` if that edge wasn't
   * found). For diagnosing why detection isn't accepting frames (which
   * edges are/aren't being found and where), not just inspecting a
   * successful capture after the fact. Doesn't change the loop's own
   * accept/reject behavior — this is a side observation, not a control.
   */
  requestForcedDebugCapture(callback: (snapshot: ForcedDebugSnapshot) => void): void {
    this.forcedDebugCallback = callback;
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

  private async evaluateFrame(): Promise<{
    result: DetectionLoopResult | null;
    edgesFound: [boolean, boolean, boolean, boolean];
  }> {
    const { videoWidth, videoHeight } = this.video;
    if (videoWidth === 0 || videoHeight === 0) {
      return { result: null, edgesFound: [false, false, false, false] };
    }
    const frameSize: Size = { width: videoWidth, height: videoHeight };

    const forcedCallback = this.forcedDebugCallback;
    this.forcedDebugCallback = null; // one-shot: this frame consumes it either way

    const needsRawBands = this.debug || forcedCallback !== null;
    const evaluation = await evaluateFrameForQuad(this.sampler, this.pool, this.video, frameSize, needsRawBands);

    if (forcedCallback && evaluation.raw) {
      forcedCallback(evaluation.raw);
    }

    if (!evaluation.accepted) {
      return { result: null, edgesFound: evaluation.edgesFound };
    }

    return {
      result: {
        corners: evaluation.accepted.corners,
        frameSize,
        frameCanvas: evaluation.accepted.frameCanvas,
        debug: this.debug && evaluation.raw ? evaluation.raw : undefined,
      },
      edgesFound: evaluation.edgesFound,
    };
  }
}
