import { CAPTURE_BURST_HARD_LIMIT, CAPTURE_BURST_MIN_USABLE_FRAMES, selectBestFrame, STANDARD_CARD_ASPECT_RATIO } from "../core";
import type { FrameCandidate } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { readQuadBoundingBoxPixels, scheduleVideoFrame, snapshotSource } from "./canvasUtils";
import { evaluateFrameForQuad } from "./frameDetection";
import type { AcceptedFrame, QuadRejectionReason } from "./frameDetection";
import { FrameSampler } from "./frameSampler";
import { videoFrameSize } from "./orientationWatcher";

/** What happened to one attempted burst frame, for the debug trail. A
 * rejected frame carries a snapshot of the video frame it was rejected on. */
export type BurstFrameDebugEntry =
  | { outcome: "accepted"; frame: AcceptedFrame }
  | { outcome: QuadRejectionReason; canvas: HTMLCanvasElement };

export interface FrameBurstResult {
  /** Accepted (unflattened) frames, in capture order. */
  accepted: AcceptedFrame[];
  /** One entry per attempted frame; empty unless `debugEnabled` (rejected
   * frames cost an extra snapshot). */
  debugFrames: BurstFrameDebugEntry[];
}

/**
 * Runs quad detection on successive video frames until
 * CAPTURE_BURST_MIN_USABLE_FRAMES are accepted, CAPTURE_BURST_HARD_LIMIT
 * frames have been attempted, or `isCancelled()` returns true. Detection only
 * — the caller picks the best frame and flattens just that one. Rejects if a
 * frame's evaluation fails unexpectedly.
 */
export async function collectBurstFrames(
  video: HTMLVideoElement,
  pool: EdgeDetectionPool,
  debugEnabled: boolean,
  isCancelled: () => boolean,
): Promise<FrameBurstResult> {
  const sampler = new FrameSampler();
  const accepted: AcceptedFrame[] = [];
  const debugFrames: BurstFrameDebugEntry[] = [];

  for (
    let attempted = 0;
    attempted < CAPTURE_BURST_HARD_LIMIT && accepted.length < CAPTURE_BURST_MIN_USABLE_FRAMES && !isCancelled();
    attempted++
  ) {
    await nextVideoFrame(video);
    const frameSize = videoFrameSize(video);
    const evaluation = await evaluateFrameForQuad(sampler, pool, video, frameSize);

    if (evaluation.status === "accepted") {
      accepted.push(evaluation.frame);
    }
    if (debugEnabled) {
      debugFrames.push(
        evaluation.status === "accepted"
          ? { outcome: "accepted", frame: evaluation.frame }
          : { outcome: evaluation.reason, canvas: snapshotSource(video, frameSize) },
      );
    }
  }

  return { accepted, debugFrames };
}

/** The best accepted burst frame, or `fallback` if the burst accepted none. */
export function selectFrameToFlatten(accepted: readonly AcceptedFrame[], fallback: AcceptedFrame): AcceptedFrame {
  const candidates = accepted.length > 0 ? accepted : [fallback];
  return selectBestFrame(candidates.map(toFrameCandidate), STANDARD_CARD_ASPECT_RATIO);
}

function toFrameCandidate(frame: AcceptedFrame): AcceptedFrame & FrameCandidate {
  return { ...frame, cardPixels: readQuadBoundingBoxPixels(frame.frameCanvas, frame.corners) };
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    scheduleVideoFrame(video, resolve);
  });
}
