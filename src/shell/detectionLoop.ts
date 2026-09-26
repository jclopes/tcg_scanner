import type { EdgeDetectionPool } from "../workers";
import { scheduleVideoFrame } from "./canvasUtils";
import { evaluateFrameForQuad } from "./frameDetection";
import type { AcceptedFrame, EdgeBands, EdgeLines, FrameEvaluation } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import { videoFrameSize } from "./orientationWatcher";

export interface DetectionLoopResult {
  frame: AcceptedFrame;
  bands: EdgeBands;
  lines: EdgeLines;
}

export interface DetectionLoopCallbacks {
  /** The first accepted frame; the loop has stopped. */
  onAccepted: (result: DetectionLoopResult) => void;
  /** Every evaluated frame's per-edge found status ([top, right, bottom, left]). */
  onFrameEvaluated: (edgesFound: [boolean, boolean, boolean, boolean]) => void;
  /** An unexpected failure (e.g. a crashed worker); the loop has stopped. */
  onError: (error: unknown) => void;
}

/**
 * Evaluates video frames one at a time until one's quad is accepted. A
 * rejected frame is an expected outcome and just moves on to the next frame.
 */
export class DetectionLoop {
  private readonly sampler = new FrameSampler();
  private cancelScheduled: (() => void) | null = null;
  private stopped = true;
  private forcedDebugCallback: ((evaluation: FrameEvaluation) => void) | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly pool: EdgeDetectionPool,
  ) {}

  start(callbacks: DetectionLoopCallbacks): void {
    this.stopped = false;

    const step = (): void => {
      this.evaluateNextFrame().then(
        (evaluation) => {
          if (this.stopped) return;
          callbacks.onFrameEvaluated(evaluation.edgesFound);
          if (evaluation.status === "accepted") {
            this.stop();
            callbacks.onAccepted({ frame: evaluation.frame, bands: evaluation.bands, lines: evaluation.lines });
          } else {
            this.cancelScheduled = scheduleVideoFrame(this.video, step);
          }
        },
        (error: unknown) => {
          if (this.stopped) return;
          this.stop();
          callbacks.onError(error);
        },
      );
    };

    this.cancelScheduled = scheduleVideoFrame(this.video, step);
  }

  /** One-shot: hands the next evaluated frame (accepted or not) to `callback`,
   * without affecting the loop. */
  requestForcedDebugCapture(callback: (evaluation: FrameEvaluation) => void): void {
    this.forcedDebugCallback = callback;
  }

  /** Idempotent. */
  stop(): void {
    this.stopped = true;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private async evaluateNextFrame(): Promise<FrameEvaluation> {
    const forcedCallback = this.forcedDebugCallback;
    this.forcedDebugCallback = null;

    const evaluation = await evaluateFrameForQuad(this.sampler, this.pool, this.video, videoFrameSize(this.video));
    forcedCallback?.(evaluation);
    return evaluation;
  }
}
