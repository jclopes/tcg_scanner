import { computeGuideGeometry } from "../core";
import type { GuideRect, Orientation, Size } from "../core";

/**
 * Draws the guide rectangle (from `computeGuideGeometry`) onto `canvas`.
 *
 * Coordinate mapping: `canvas.width`/`canvas.height` (its internal pixel
 * buffer) are set to exactly match `frameSize` (the video's intrinsic
 * `videoWidth`/`videoHeight`) every call, so guide coordinates — computed
 * in that same frame-pixel space — can be drawn directly with no extra
 * scaling math here. Getting the canvas's *rendered* CSS size to line up
 * pixel-for-pixel with the video's rendered CSS size (so the overlay
 * visually sits on top of the right part of the picture) is the caller's
 * job: src/shell/app.ts keeps the camera-stage container's CSS
 * `aspect-ratio` equal to `frameSize`'s ratio, and both `<video>` and
 * `<canvas>` fill that container at 100% width/height — since their
 * rendered box always matches the frame's own aspect ratio, there's no
 * letterboxing/cropping mismatch between the two to account for.
 *
 * Returns the `GuideRect` that was drawn, so the caller (the detection
 * loop) can reuse the exact same geometry rather than recomputing it.
 */
export function drawGuideOverlay(canvas: HTMLCanvasElement, camera: Orientation, frameSize: Size): GuideRect {
  if (canvas.width !== frameSize.width || canvas.height !== frameSize.height) {
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
  }

  const guide = computeGuideGeometry(camera, frameSize);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return guide;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const left = guide.center.x - guide.width / 2;
  const top = guide.center.y - guide.height / 2;

  ctx.lineWidth = Math.max(2, frameSize.width * 0.004);
  ctx.strokeStyle = "rgba(56, 224, 130, 0.95)";
  ctx.strokeRect(left, top, guide.width, guide.height);

  return guide;
}

/** Clears the overlay canvas (e.g. when leaving the "scanning" state). */
export function clearGuideOverlay(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}
