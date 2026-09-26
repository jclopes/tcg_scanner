import { computeGuideGeometry, computeOutputRotationDegrees } from "../core";
import type { CardPrintFormat, Orientation, Point, Size } from "../core";
import { require2dContext } from "./canvasUtils";

export type EdgeColors = readonly [string, string, string, string];

export const GUIDE_EDGE_NOT_FOUND_COLOR = "rgba(56, 224, 130, 0.95)";
export const GUIDE_EDGE_FOUND_COLOR = "rgba(239, 68, 68, 0.95)";
export const GUIDE_EDGE_ALL_FOUND_FLASH_COLOR = "rgba(255, 255, 255, 0.95)";

/** How long the all-edges-found white flash stays up. */
export const GUIDE_ALL_FOUND_FLASH_DURATION_MS = 500;

export const DEFAULT_GUIDE_EDGE_COLORS: EdgeColors = [
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
  GUIDE_EDGE_NOT_FOUND_COLOR,
];

export const ALL_FOUND_FLASH_EDGE_COLORS: EdgeColors = [
  GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
  GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
  GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
  GUIDE_EDGE_ALL_FOUND_FLASH_COLOR,
];

/** Per-edge colors ([top, right, bottom, left]) for a frame's detection result. */
export function edgeColorsForDetection(edgesFound: readonly [boolean, boolean, boolean, boolean]): EdgeColors {
  const color = (found: boolean): string => (found ? GUIDE_EDGE_FOUND_COLOR : GUIDE_EDGE_NOT_FOUND_COLOR);
  const [top, right, bottom, left] = edgesFound;
  return [color(top), color(right), color(bottom), color(left)];
}

/**
 * Redraws the guide rectangle (one color per edge) and the "TOP" indicator.
 * The canvas buffer is sized to `frameSize`, so guide coordinates are drawn
 * as-is; the page keeps the canvas's CSS box matching the video's.
 */
export function drawGuideOverlay(
  canvas: HTMLCanvasElement,
  camera: Orientation,
  frameSize: Size,
  edgeColors: EdgeColors,
  cardFormat: CardPrintFormat,
): void {
  if (canvas.width !== frameSize.width || canvas.height !== frameSize.height) {
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
  }

  const ctx = require2dContext(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const guide = computeGuideGeometry(camera, frameSize);
  const left = guide.center.x - guide.width / 2;
  const top = guide.center.y - guide.height / 2;
  const right = left + guide.width;
  const bottom = top + guide.height;

  ctx.lineWidth = Math.max(2, frameSize.width * 0.004);
  // Square caps so the separately-stroked edges meet cleanly at the corners.
  ctx.lineCap = "square";

  const corners: Point[] = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  edgeColors.forEach((color, i) => {
    const from = corners[i]!;
    const to = corners[(i + 1) % 4]!;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  drawCardTopIndicator(ctx, frameSize, camera, cardFormat);
}

/** Labels the frame side the card's top edge should face: the top of the
 * frame when orientations match, otherwise the left side (see
 * computeOutputRotationDegrees). */
function drawCardTopIndicator(
  ctx: CanvasRenderingContext2D,
  frameSize: Size,
  camera: Orientation,
  cardFormat: CardPrintFormat,
): void {
  const padding = frameSize.width * 0.08;
  const placement =
    computeOutputRotationDegrees(camera, cardFormat) === 0
      ? { x: frameSize.width / 2, y: padding, angle: 0 }
      : { x: padding, y: frameSize.height / 2, angle: -Math.PI / 2 };

  ctx.save();
  ctx.fillStyle = "rgba(200, 200, 200, 0.8)";
  ctx.font = `${Math.max(16, frameSize.width * 0.05)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(placement.x, placement.y);
  ctx.rotate(placement.angle);
  ctx.fillText("^ TOP ^", 0, 0);
  ctx.restore();
}

export function clearGuideOverlay(canvas: HTMLCanvasElement): void {
  require2dContext(canvas).clearRect(0, 0, canvas.width, canvas.height);
}
