import type { EdgeBandPixels, FittedLine, Quad } from "../core";
import { canvasToObjectURL, createCanvas, require2dContext, rotateCanvas } from "./canvasUtils";
import type { BurstFrameDebugEntry } from "./frameBurst";
import type { EdgeBands, EdgeLines, QuadRejectionReason } from "./frameDetection";

/** One labeled image in the debug trail. `variant: "edge-band"` gives the
 * long, thin band strips their own CSS sizing. */
export interface DebugStep {
  label: string;
  canvas: HTMLCanvasElement;
  variant?: "edge-band";
}

/** A text entry in the debug trail: a section heading or a rejection reason. */
export interface DebugNote {
  text: string;
  kind: "heading" | "rejection";
}

export type DebugEntry = DebugStep | DebugNote;

const EDGE_LABELS = ["Top edge", "Right edge", "Bottom edge", "Left edge"] as const;

const OVERLAY_STROKE_STYLE = "rgba(56, 224, 130, 0.95)";

export function debugStageHeading(text: string): DebugNote {
  return { text, kind: "heading" };
}

export function debugRejectionNote(reason: QuadRejectionReason): DebugNote {
  return { text: `Rejected: ${describeRejectionReason(reason)}`, kind: "rejection" };
}

/** The 4 band strips ([top, right, bottom, left]) with their fitted line drawn
 * on top, or labeled "not detected". Vertical bands are rotated so every strip
 * reads horizontally. */
export function buildEdgeBandSteps(bands: EdgeBands, lines: EdgeLines): DebugStep[] {
  return bands.map((band, i) => {
    const line = lines[i]!;
    const label = line ? EDGE_LABELS[i]! : `${EDGE_LABELS[i]!} — not detected`;
    return { label, canvas: renderEdgeBand(band, line), variant: "edge-band" };
  });
}

/** `sourceCanvas` with the quad outlined on top. */
export function buildQuadOverlayStep(sourceCanvas: HTMLCanvasElement, corners: Quad, label: string): DebugStep {
  const canvas = createCanvas(sourceCanvas);
  const ctx = require2dContext(canvas);
  ctx.drawImage(sourceCanvas, 0, 0);

  ctx.strokeStyle = OVERLAY_STROKE_STYLE;
  ctx.lineWidth = Math.max(2, sourceCanvas.width * 0.004);
  ctx.beginPath();
  for (const corner of corners) {
    ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  ctx.stroke();

  return { label, canvas };
}

/** One step per attempted burst frame, 1-indexed, in capture order. */
export function buildBurstFrameSteps(entries: readonly BurstFrameDebugEntry[]): DebugStep[] {
  return entries.map((entry, i) =>
    entry.outcome === "accepted"
      ? buildQuadOverlayStep(entry.frame.frameCanvas, entry.frame.corners, `Burst frame ${i + 1}: accepted`)
      : {
          label: `Burst frame ${i + 1}: rejected — ${describeRejectionReason(entry.outcome)}`,
          canvas: entry.canvas,
        },
  );
}

/** Object URLs backing the panel's current images, revoked on the next render. */
let activeObjectURLs: string[] = [];

/** Replaces `panel`'s contents with `entries`, top to bottom. */
export function renderDebugSteps(panel: HTMLElement, entries: readonly DebugEntry[]): void {
  for (const url of activeObjectURLs) {
    URL.revokeObjectURL(url);
  }
  activeObjectURLs = [];
  panel.replaceChildren(...entries.map(toElement));
}

function toElement(entry: DebugEntry): HTMLElement {
  return "text" in entry ? toNoteElement(entry) : toFigure(entry);
}

function toNoteElement(note: DebugNote): HTMLElement {
  const p = document.createElement("p");
  p.className = note.kind === "rejection" ? "debug-rejection-reason" : "debug-stage-heading";
  p.textContent = note.text;
  return p;
}

function describeRejectionReason(reason: QuadRejectionReason): string {
  switch (reason) {
    case "edge-not-found":
      return "one or more edges weren't found";
    case "parallel-edges":
      return "adjacent edges didn't form a valid corner";
    case "aspect-ratio-out-of-tolerance":
      return "the quad's aspect ratio didn't match a card";
  }
}

/** Shows the step as an `<img>` (not a bare canvas) so the browser offers
 * "open/save image". Starts with a synchronous `data:` URL, then swaps to a
 * `blob:` URL, which stays openable at full resolution. */
function toFigure(step: DebugStep): HTMLElement {
  const figure = document.createElement("figure");
  if (step.variant) {
    figure.className = `debug-step--${step.variant}`;
  }
  const img = document.createElement("img");
  img.src = step.canvas.toDataURL("image/png");
  img.width = step.canvas.width;
  img.height = step.canvas.height;
  img.alt = step.label;
  void canvasToObjectURL(step.canvas).then((url) => {
    img.src = url;
    activeObjectURLs.push(url);
  });
  const figcaption = document.createElement("figcaption");
  figcaption.textContent = step.label;
  figure.append(img, figcaption);
  return figure;
}

function renderEdgeBand(band: EdgeBandPixels, line: FittedLine | null): HTMLCanvasElement {
  const canvas = createCanvas(band);
  const ctx = require2dContext(canvas);

  const imageData = ctx.createImageData(band.width, band.height);
  band.data.forEach((value, i) => {
    imageData.data.set([value, value, value, 255], i * 4);
  });
  ctx.putImageData(imageData, 0, 0);

  if (line) {
    drawLineAcrossBand(ctx, line, band.width, band.height);
  }

  return canvas.height > canvas.width ? rotateCanvas(canvas, 90) : canvas;
}

/** Draws the infinite `line` far enough in both directions to cross the band. */
function drawLineAcrossBand(ctx: CanvasRenderingContext2D, line: FittedLine, width: number, height: number): void {
  const span = width + height;
  const { point, direction } = line;

  ctx.strokeStyle = OVERLAY_STROKE_STYLE;
  ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  ctx.beginPath();
  ctx.moveTo(point.x - direction.x * span, point.y - direction.y * span);
  ctx.lineTo(point.x + direction.x * span, point.y + direction.y * span);
  ctx.stroke();
}
