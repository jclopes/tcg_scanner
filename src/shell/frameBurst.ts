import { CAPTURE_BURST_FRAME_COUNT, CAPTURE_BURST_HARD_LIMIT, CAPTURE_BURST_MIN_USABLE_FRAMES } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { scheduleVideoFrame, snapshotSource } from "./canvasUtils";
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
 * Runs quad detection on `frameCount` successive video frames and collects
 * the accepted ones. Detection only — the caller picks the best frame and
 * flattens just that one. Rejects if a frame's evaluation fails unexpectedly.
 */
async function captureFrameBurst(
  video: HTMLVideoElement,
  pool: EdgeDetectionPool,
  frameCount: number,
  debugEnabled: boolean,
): Promise<FrameBurstResult> {
  const sampler = new FrameSampler();
  const accepted: AcceptedFrame[] = [];
  const debugFrames: BurstFrameDebugEntry[] = [];

  for (let i = 0; i < frameCount; i++) {
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

/**
 * Runs bursts of CAPTURE_BURST_FRAME_COUNT frames until
 * CAPTURE_BURST_MIN_USABLE_FRAMES are accepted, CAPTURE_BURST_HARD_LIMIT
 * frames have been attempted, or `isCancelled()` returns true.
 */
export async function collectBurstFrames(
  video: HTMLVideoElement,
  pool: EdgeDetectionPool,
  debugEnabled: boolean,
  isCancelled: () => boolean,
): Promise<FrameBurstResult> {
  const accepted: AcceptedFrame[] = [];
  const debugFrames: BurstFrameDebugEntry[] = [];
  let attempted = 0;

  while (
    accepted.length < CAPTURE_BURST_MIN_USABLE_FRAMES &&
    attempted < CAPTURE_BURST_HARD_LIMIT &&
    !isCancelled()
  ) {
    const frameCount = Math.min(CAPTURE_BURST_FRAME_COUNT, CAPTURE_BURST_HARD_LIMIT - attempted);
    const burst = await captureFrameBurst(video, pool, frameCount, debugEnabled);
    accepted.push(...burst.accepted);
    debugFrames.push(...burst.debugFrames);
    attempted += frameCount;
  }

  return { accepted, debugFrames };
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    scheduleVideoFrame(video, resolve);
  });
}
