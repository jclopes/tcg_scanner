import { computeGuideGeometry, computeOutputRotationDegrees } from "../core";
import type { CardPrintFormat, GuideRect, Orientation, Point, Size } from "../core";

/** Guide edge color when that edge's `fitEdgeLine` call has *not* found an
 * edge in the most recently evaluated frame — the original, only color the
 * guide ever used before per-edge live feedback existed. */
export const GUIDE_EDGE_NOT_FOUND_COLOR = "rgba(56, 224, 130, 0.95)";
/** Guide edge color once that edge *has* been found. */
export const GUIDE_EDGE_FOUND_COLOR = "rgba(239, 68, 68, 0.95)";
/** Guide color for the brief all-4-edges-found flash — see
 * `GUIDE_ALL_FOUND_FLASH_DURATION_MS` and app.ts's flash-timing logic. */
export const GUIDE_EDGE_ALL_FOUND_FLASH_COLOR = "rgba(255, 255, 255, 0.95)";

/** How long the all-4-edges-found white flash stays up before reverting to
 * the (all-red) steady-state colors — half a second, per the feature's own
 * spec; not derived from anything else, just a UX-feel judgment call. */
export const GUIDE_ALL_FOUND_FLASH_DURATION_MS = 500;

/** The guide's default, pre-any-detection appearance: every edge "not
 * found" (green). */
export const DEFAULT_GUIDE_EDGE_COLORS: readonly [string, string, string, string] = [
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
];

/** Maps a frame's per-edge found/not-found status ([top, right, bottom,
 * left], matching `FrameEvaluation.edgesFound`'s order) to the steady-state
 * guide colors it implies — found edges red, not-found edges green. Not
 * responsible for the all-found white flash itself (a transient override
 * layered on top by app.ts, which also owns the flash's timing/state). */
export function edgeColorsForDetection(
  edgesFound: readonly [boolean, boolean, boolean, boolean],
): [string, string, string, string] {
  return edgesFound.map((found) => (found ? GUIDE_EDGE_FOUND_COLOR : GUIDE_EDGE_NOT_FOUND_COLOR)) as [
    string,
    string,
    string,
    string,
  ];
}

/**
 * Draws the guide rectangle (from `computeGuideGeometry`) onto `canvas`, one
 * edge at a time so each can have its own color — [top, right, bottom,
 * left], matching `edgesFound`'s order elsewhere. Defaults to
 * `DEFAULT_GUIDE_EDGE_COLORS` (all "not found") when `edgeColors` is
 * omitted, for callers that just want the plain initial/resize-redraw guide
 * with no live detection feedback yet.
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
export function drawGuideOverlay(
  canvas: HTMLCanvasElement,
  camera: Orientation,
  frameSize: Size,
  edgeColors: readonly [string, string, string, string] = DEFAULT_GUIDE_EDGE_COLORS,
  cardFormat: CardPrintFormat = "portrait",
): GuideRect {
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
  const right = left + guide.width;
  const bottom = top + guide.height;

  ctx.lineWidth = Math.max(2, frameSize.width * 0.004);
  // "square" line caps extend each segment half a line-width past its own
  // endpoint — without it (the "butt" default), adjacent edges drawn as
  // separate strokes leave a small notch at each corner instead of meeting
  // cleanly the way a single strokeRect() call used to.
  ctx.lineCap = "square";

  const [topColor, rightColor, bottomColor, leftColor] = edgeColors;
  const segments: [string, Point, Point][] = [
    [topColor, { x: left, y: top }, { x: right, y: top }],
    [rightColor, { x: right, y: top }, { x: right, y: bottom }],
    [bottomColor, { x: right, y: bottom }, { x: left, y: bottom }],
    [leftColor, { x: left, y: bottom }, { x: left, y: top }],
  ];
  for (const [color, from, to] of segments) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  drawCardTopIndicator(ctx, frameSize, camera, cardFormat);

  return guide;
}

/** Draws a "TOP" indicator pointing to which side of the frame the card's top
 * edge should be aligned to, based on the camera orientation and card format.
 * Text is rotated to match the orientation of the card. */
function drawCardTopIndicator(
  ctx: CanvasRenderingContext2D,
  frameSize: Size,
  camera: Orientation,
  cardFormat: CardPrintFormat,
): void {
  const rotation = computeOutputRotationDegrees(camera, cardFormat);

  ctx.fillStyle = "rgba(200, 200, 200, 0.8)";
  ctx.font = `${Math.max(16, frameSize.width * 0.05)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const padding = frameSize.width * 0.08;

  if (rotation === 0) {
    ctx.save();
    ctx.translate(frameSize.width / 2, padding);
    ctx.rotate(0);
    ctx.fillText("^ TOP ^", 0, 0);
    ctx.restore();
  } else if (rotation === 90) {
    ctx.save();
    ctx.translate(padding, frameSize.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("^ TOP ^", 0, 0);
    ctx.restore();
  } else if (rotation === 180) {
    ctx.save();
    ctx.translate(frameSize.width / 2, frameSize.height - padding);
    ctx.rotate(Math.PI);
    ctx.fillText("^ TOP ^", 0, 0);
    ctx.restore();
  } else if (rotation === 270) {
    ctx.save();
    ctx.translate(frameSize.width - padding, frameSize.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText("^ TOP ^", 0, 0);
    ctx.restore();
  }
}

/** Clears the overlay canvas (e.g. when leaving the "scanning" state). */
export function clearGuideOverlay(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}
