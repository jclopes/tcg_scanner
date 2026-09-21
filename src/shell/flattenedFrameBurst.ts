import type { CardPrintFormat, OpenCv, Orientation, RgbaPixelBuffer } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { captureFlattenedCard } from "./capture";
import { evaluateFrameForQuad } from "./frameDetection";
import type { QuadRejectionReason } from "./frameDetection";
import { FrameSampler } from "./frameSampler";

/** What became of one attempted burst frame — either it was successfully
 * detected+flattened ("captured"), or why it wasn't (reusing
 * `QuadRejectionReason`, the same labels the live preview loop's own
 * rejections use). Purely for the debug feature — see
 * `FlattenedFrameBurstResult.debugFrames`. */
export type BurstFrameOutcome = "captured" | QuadRejectionReason;

export interface BurstFrameDebugEntry {
  /** For a "captured" frame, the flattened output (the same image that fed
   * into `flattened`); otherwise a snapshot of the raw video frame at the
   * moment detection was attempted on it — a flattened image was never
   * produced for a rejected frame. */
  canvas: HTMLCanvasElement;
  outcome: BurstFrameOutcome;
}

export interface FlattenedFrameBurstResult {
  /** The successfully captured+flattened frames, in capture order — the
   * candidate pool `selectBestFrame` (src/core/frameQuality.ts) picks the
   * final output from. */
  flattened: RgbaPixelBuffer[];
  /** One entry per *attempted* frame (up to `frameCount`), in capture
   * order — including the ones that didn't make it into `flattened`, so a
   * caller can show what happened to every frame, not just the survivors.
   * `null` unless `debugEnabled` was passed — real per-frame cost (an
   * extra snapshot draw for every attempt, not just the accepted ones),
   * so callers that don't need it skip paying for it, same convention as
   * evaluateFrameForQuad's `needsRawBands`. */
  debugFrames: BurstFrameDebugEntry[] | null;
}

/**
 * Captures up to `frameCount` successive live-video frames and, for each,
 * independently runs the *same* detection+flatten pipeline used everywhere
 * else (`evaluateFrameForQuad` + `captureFlattenedCard`) — producing up to
 * `frameCount` already-upright, already-cropped card images. The caller
 * (src/shell/app.ts) picks the single best of these via `selectBestFrame`
 * rather than committing to whichever one frame originally triggered
 * acceptance, on the theory that a few frames later, mid-hold, is likely to
 * catch a sharper, better-aligned moment than the very first frame that
 * happened to pass detection.
 *
 * A frame whose own detection pass doesn't accept a quad is simply
 * skipped — a frame too blurred or too displaced to detect a quad in at
 * all wouldn't have produced a usable flatten anyway, so there's nothing
 * left to filter afterward.
 *
 * Uses `requestVideoFrameCallback` when available — ties capture to actual
 * new camera frames rather than the display's refresh rate, same reasoning
 * as `DetectionLoop`'s own scheduling — falling back to
 * `requestAnimationFrame` when it isn't (e.g. older Safari).
 */
export function captureFlattenedFrameBurst(
  video: HTMLVideoElement,
  pool: EdgeDetectionPool,
  cv: OpenCv,
  frameCount: number,
  camera: Orientation,
  cardFormat: CardPrintFormat,
  debugEnabled: boolean,
): Promise<FlattenedFrameBurstResult> {
  const sampler = new FrameSampler();

  return new Promise((resolve) => {
    const flattened: RgbaPixelBuffer[] = [];
    const debugFrames: BurstFrameDebugEntry[] | null = debugEnabled ? [] : null;
    let attempted = 0;

    const captureOne = (): void => {
      attempted++;
      evaluateOneFrame()
        .catch((error: unknown) => {
          // A single frame's detection/flatten failing must not abort the
          // whole burst — same fail-fast-per-frame stance as
          // DetectionLoop's own per-frame catch.
          console.error("Frame evaluation failed during multi-frame capture; skipping this frame.", error);
          return null;
        })
        .then((buffer) => {
          if (buffer) {
            flattened.push(buffer);
          }
          if (attempted >= frameCount) {
            resolve({ flattened, debugFrames });
            return;
          }
          scheduleNext();
        });
    };

    async function evaluateOneFrame(): Promise<RgbaPixelBuffer | null> {
      const { videoWidth, videoHeight } = video;
      if (videoWidth === 0 || videoHeight === 0) {
        return null;
      }
      const frameSize = { width: videoWidth, height: videoHeight };
      const evaluation = await evaluateFrameForQuad(sampler, pool, video, frameSize, debugEnabled);

      if (!evaluation.accepted) {
        if (debugFrames) {
          debugFrames.push({
            canvas: snapshotVideoFrame(video, videoWidth, videoHeight),
            outcome: evaluation.raw?.rejectionReason ?? "edge-not-found",
          });
        }
        return null;
      }

      const output = await captureFlattenedCard({
        cv,
        frameCanvas: evaluation.accepted.frameCanvas,
        corners: evaluation.accepted.corners,
        camera,
        cardFormat,
      });
      if (debugFrames) {
        debugFrames.push({ canvas: output.canvas, outcome: "captured" });
      }
      return canvasToRgbaBuffer(output.canvas);
    }

    function scheduleNext(): void {
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(captureOne);
      } else {
        requestAnimationFrame(captureOne);
      }
    }

    scheduleNext();
  });
}

function canvasToRgbaBuffer(canvas: HTMLCanvasElement): RgbaPixelBuffer {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to read a flattened frame's pixels.");
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: imageData.data, width: imageData.width, height: imageData.height };
}

/** A plain snapshot of `video`'s current frame — used for the debug
 * feature's rejected-frame thumbnails, where (unlike an accepted frame)
 * there's no flattened output to show instead. */
function snapshotVideoFrame(video: HTMLVideoElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context for a debug frame snapshot.");
  }
  ctx.drawImage(video, 0, 0, width, height);
  return canvas;
}
