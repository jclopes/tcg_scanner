import type { EdgeBandPixels, FittedLine, PerEdge, Quad } from "../core";
import { canvasToObjectURL, createCanvas, pixelsToCanvas, require2dContext, rotateCanvas } from "./canvasUtils";
import type { BurstFrameDebugEntry, FrameBurstResult } from "./frameBurst";
import type { AcceptedEvaluation, AcceptedFrame, FrameEvaluation, QuadRejectionReason } from "./frameDetection";
import type { RegionResult } from "./identify";
import type { TextCropAnalysis } from "./regionExtraction";

/** One labeled image in the debug trail. `variant: "edge-band"` gives the
 * long, thin band strips their own CSS sizing. */
interface DebugStep {
  label: string;
  canvas: HTMLCanvasElement;
  variant?: "edge-band";
}

/** A text entry in the debug trail: a section heading or a rejection reason. */
interface DebugNote {
  text: string;
  kind: "heading" | "rejection";
}

export type DebugEntry = DebugStep | DebugNote;

const EDGE_LABELS = ["Top edge", "Right edge", "Bottom edge", "Left edge"] as const;

const OVERLAY_STROKE_STYLE = "rgba(56, 224, 130, 0.95)";

function debugStageHeading(text: string): DebugNote {
  return { text, kind: "heading" };
}

function debugRejectionNote(reason: QuadRejectionReason): DebugNote {
  return { text: `Rejected: ${describeRejectionReason(reason)}`, kind: "rejection" };
}

/** The 4 band strips ([top, right, bottom, left]) with their fitted line drawn
 * on top, or labeled "not detected". Vertical bands are rotated so every strip
 * reads horizontally. */
function buildEdgeBandSteps(bands: PerEdge<EdgeBandPixels>, lines: PerEdge<FittedLine | null>): DebugStep[] {
  return bands.map((band, i) => {
    const line = lines[i]!;
    const label = line ? EDGE_LABELS[i]! : `${EDGE_LABELS[i]!} — not detected`;
    return { label, canvas: renderEdgeBand(band, line), variant: "edge-band" };
  });
}

/** The accepted frame with its quad outlined on top. */
function buildQuadOverlayStep(frame: AcceptedFrame, label: string): DebugStep {
  const { corners } = frame;
  const canvas = pixelsToCanvas(frame.pixels);
  const ctx = require2dContext(canvas);

  ctx.strokeStyle = OVERLAY_STROKE_STYLE;
  ctx.lineWidth = Math.max(2, canvas.width * 0.004);
  ctx.beginPath();
  for (const corner of corners) {
    ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  ctx.stroke();

  return { label, canvas };
}

const TEXT_PROFILE_STYLE = "rgba(80, 200, 255, 0.8)";
const LINE_PROFILE_STYLE = "rgba(255, 150, 40, 0.8)";

/**
 * A text region's search area with its profile plots: row profiles on the
 * right (glyph-stroke energy in blue, horizontal-line energy in orange),
 * the column profile underneath (blue), each scaled to its own max with its
 * threshold as a marker line. The crop rectangle is drawn in green across the
 * image and plots.
 */
function buildTextBandStep(regionLabel: string, searchCanvas: HTMLCanvasElement, analysis: TextCropAnalysis): DebugStep {
  const { rows, columns } = analysis;
  const plotWidth = Math.max(40, Math.round(searchCanvas.width * 0.5));
  const plotHeight = Math.max(30, Math.round(searchCanvas.height * 0.5));
  const canvas = createCanvas({ width: searchCanvas.width + plotWidth, height: searchCanvas.height + plotHeight });
  const ctx = require2dContext(canvas);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(searchCanvas, 0, 0);

  drawRowProfile(ctx, rows.textProfile, rows.textThreshold, searchCanvas.width, plotWidth, TEXT_PROFILE_STYLE);
  drawRowProfile(ctx, rows.lineProfile, rows.lineThreshold, searchCanvas.width, plotWidth, LINE_PROFILE_STYLE);
  if (columns) {
    drawColumnProfile(ctx, columns.profile, columns.threshold, canvas.height, plotHeight, TEXT_PROFILE_STYLE);
  }

  ctx.strokeStyle = OVERLAY_STROKE_STYLE;
  ctx.lineWidth = Math.max(1, Math.round(searchCanvas.height * 0.01));
  ctx.beginPath();
  for (const y of rows.crop ? [rows.crop.top, rows.crop.bottom] : []) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  for (const x of columns?.crop ? [columns.crop.left, columns.crop.right] : []) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  ctx.stroke();

  const outcome = rows.crop ? "text crop" : "no text found, using full search area";
  return { label: `Region: ${regionLabel} — ${outcome}`, canvas };
}

/** One 1px-tall bar per row, length proportional to `profile[y] / max`, plus
 * a vertical marker at `threshold`. */
function drawRowProfile(
  ctx: CanvasRenderingContext2D,
  profile: readonly number[],
  threshold: number,
  left: number,
  width: number,
  style: string,
): void {
  const max = Math.max(...profile);
  if (max <= 0) {
    return;
  }
  ctx.fillStyle = style;
  profile.forEach((value, y) => {
    ctx.fillRect(left, y, (value / max) * width, 1);
  });
  ctx.strokeStyle = style;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + (threshold / max) * width, 0);
  ctx.lineTo(left + (threshold / max) * width, profile.length);
  ctx.stroke();
}

/** One 1px-wide bar per column, rising from `bottom`, height proportional to
 * `profile[x] / max`, plus a horizontal marker at `threshold`. */
function drawColumnProfile(
  ctx: CanvasRenderingContext2D,
  profile: readonly number[],
  threshold: number,
  bottom: number,
  height: number,
  style: string,
): void {
  const max = Math.max(...profile);
  if (max <= 0) {
    return;
  }
  ctx.fillStyle = style;
  profile.forEach((value, x) => {
    const barHeight = (value / max) * height;
    ctx.fillRect(x, bottom - barHeight, 1, barHeight);
  });
  const thresholdY = bottom - (threshold / max) * height;
  ctx.strokeStyle = style;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, thresholdY);
  ctx.lineTo(profile.length, thresholdY);
  ctx.stroke();
}

/** One step per attempted burst frame, 1-indexed, in capture order. */
function buildBurstFrameSteps(entries: readonly BurstFrameDebugEntry[]): DebugStep[] {
  return entries.map((entry, i) =>
    entry.outcome === "accepted"
      ? buildQuadOverlayStep(entry.frame, `Burst frame ${i + 1}: accepted`)
      : {
          label: `Burst frame ${i + 1}: rejected — ${describeRejectionReason(entry.outcome)}`,
          canvas: entry.canvas,
        },
  );
}

/** The debug trail for one capture, top to bottom: the preview detection,
 * every burst frame, the selected frame, the flattened card and its regions. */
export function buildCaptureDebugTrail(
  preview: AcceptedEvaluation,
  burst: FrameBurstResult,
  selected: AcceptedFrame,
  cardCanvas: HTMLCanvasElement,
  regionResults: readonly RegionResult[],
): DebugEntry[] {
  return [
    ...buildEdgeBandSteps(preview.bands, preview.lines),
    buildQuadOverlayStep(preview.frame, "Detected quad"),
    debugStageHeading(`Burst capture — ${burst.accepted.length}/${burst.debugFrames.length} usable`),
    ...buildBurstFrameSteps(burst.debugFrames),
    buildQuadOverlayStep(selected, "Selected frame"),
    { label: "Flattened output", canvas: cardCanvas },
    ...regionResults.flatMap(({ crop: { region, searchCanvas, analysis, canvas }, ocr }) =>
      analysis && ocr
        ? [
            buildTextBandStep(region.label, searchCanvas, analysis),
            {
              label: `Region: ${region.label} — OCR input${ocr.inverted ? " (inverted)" : ""} → "${ocr.text}"`,
              canvas: ocr.canvas,
            },
          ]
        : [{ label: `Region: ${region.label}`, canvas }],
    ),
  ];
}

/** A forced debug capture's trail: `heading`, the rejection reason if any,
 * and the 4 edge bands. */
export function buildForcedDebugTrail(evaluation: FrameEvaluation, heading: string): DebugEntry[] {
  return [
    debugStageHeading(heading),
    ...(evaluation.status === "rejected" ? [debugRejectionNote(evaluation.reason)] : []),
    ...buildEdgeBandSteps(evaluation.bands, evaluation.lines),
  ];
}

export interface DebugPanelElements {
  /** Where the debug trail is rendered. */
  panel: HTMLElement;
  /** The "Debug mode" checkbox. */
  checkbox: HTMLInputElement;
  /** Debug-only controls (the forced-capture button), shown with the panel. */
  controls: HTMLElement;
}

/** The debug panel, its "Debug mode" toggle, and the `blob:` URLs backing its
 * current images, which are revoked whenever its contents are replaced. */
export class DebugPanel {
  private objectUrls: string[] = [];
  /** Bumped on every render/clear so a blob URL that resolves late, for an
   * image no longer shown, is revoked instead of kept. */
  private generation = 0;

  constructor(private readonly elements: DebugPanelElements) {
    elements.checkbox.addEventListener("change", () => {
      elements.panel.hidden = !this.enabled;
      elements.controls.hidden = !this.enabled;
      if (!this.enabled) {
        this.clear();
      }
    });
  }

  /** Whether debug mode is on. Read when a scan starts; toggling mid-scan
   * applies to the next scan. */
  get enabled(): boolean {
    return this.elements.checkbox.checked;
  }

  /** Replaces the panel's contents with `entries`, top to bottom. */
  render(entries: readonly DebugEntry[]): void {
    this.clear();
    this.elements.panel.replaceChildren(...entries.map((entry) => ("text" in entry ? toNoteElement(entry) : this.toFigure(entry))));
  }

  clear(): void {
    this.generation += 1;
    for (const url of this.objectUrls) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls = [];
    this.elements.panel.replaceChildren();
  }

  /** Shows the step as an `<img>` (not a bare canvas) so the browser offers
   * "open/save image". Starts with a synchronous `data:` URL, then swaps to a
   * `blob:` URL, which stays openable at full resolution. */
  private toFigure(step: DebugStep): HTMLElement {
    const figure = document.createElement("figure");
    if (step.variant) {
      figure.className = `debug-step--${step.variant}`;
    }
    const img = document.createElement("img");
    img.src = step.canvas.toDataURL("image/png");
    img.width = step.canvas.width;
    img.height = step.canvas.height;
    img.alt = step.label;
    const generation = this.generation;
    canvasToObjectURL(step.canvas).then(
      (url) => {
        if (generation !== this.generation) {
          URL.revokeObjectURL(url);
          return;
        }
        img.src = url;
        this.objectUrls.push(url);
      },
      (error: unknown) => console.error(`Could not encode debug image "${step.label}"; keeping its data: URL.`, error),
    );
    const figcaption = document.createElement("figcaption");
    figcaption.textContent = step.label;
    figure.append(img, figcaption);
    return figure;
  }
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
