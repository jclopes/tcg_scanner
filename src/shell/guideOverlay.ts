import { computeGuideGeometry, computeOutputRotationDegrees, mapEdges } from "../core";
import type { CardOrientation, Orientation, PerEdge, Point, Size } from "../core";
import { require2dContext } from "./canvasUtils";
import { paletteColor } from "./dom";

/** Palette colors in index.html. */
type GuideColor = "--guide-not-found" | "--guide-found" | "--guide-flash";

export type EdgeColors = PerEdge<GuideColor>;

/** How long the all-edges-found white flash stays up. */
export const GUIDE_ALL_FOUND_FLASH_DURATION_MS = 500;

export const DEFAULT_GUIDE_EDGE_COLORS: EdgeColors = ["--guide-not-found", "--guide-not-found", "--guide-not-found", "--guide-not-found"];

export const ALL_FOUND_FLASH_EDGE_COLORS: EdgeColors = ["--guide-flash", "--guide-flash", "--guide-flash", "--guide-flash"];

/** Per-edge colors for a frame's detection result. */
export function edgeColorsForDetection(edgesFound: PerEdge<boolean>): EdgeColors {
  return mapEdges(edgesFound, (found) => (found ? "--guide-found" : "--guide-not-found"));
}

/** Redraws the guide rectangle (one color per edge) and the TOP pill in frame
 * pixels: the canvas buffer is sized to `frameSize`. */
export function drawGuideOverlay(
  canvas: HTMLCanvasElement,
  camera: Orientation,
  frameSize: Size,
  edgeColors: EdgeColors,
  cardOrientation: CardOrientation,
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
    ctx.strokeStyle = paletteColor(color);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  });

  drawCardTopIndicator(ctx, frameSize, { left, top, bottom }, camera, cardOrientation);
}

/** A "▲ TOP" pill on the guide edge the card's top should face: the left
 * edge when the card is rotated (see computeOutputRotationDegrees). */
function drawCardTopIndicator(
  ctx: CanvasRenderingContext2D,
  frameSize: Size,
  guide: { left: number; top: number; bottom: number },
  camera: Orientation,
  cardOrientation: CardOrientation,
): void {
  const placement =
    computeOutputRotationDegrees(camera, cardOrientation) === 0
      ? { x: frameSize.width / 2, y: guide.top, angle: 0 }
      : { x: guide.left, y: (guide.top + guide.bottom) / 2, angle: -Math.PI / 2 };
  const fontSize = Math.max(14, frameSize.width * 0.035);
  const label = "▲ TOP";

  ctx.save();
  ctx.translate(placement.x, placement.y);
  ctx.rotate(placement.angle);
  ctx.font = `bold ${fontSize}px sans-serif`;
  const width = ctx.measureText(label).width + fontSize * 1.2;
  const height = fontSize * 1.6;
  ctx.fillStyle = paletteColor("--scrim");
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height / 2, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = paletteColor("--on-scrim");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

export function clearGuideOverlay(canvas: HTMLCanvasElement): void {
  require2dContext(canvas).clearRect(0, 0, canvas.width, canvas.height);
}
