import type { EdgeBandPixels, FittedLine, Point } from "../core";
import { canvasToObjectURL } from "./canvasUtils";
import type { BurstFrameDebugEntry } from "./flattenedFrameBurst";
import type { QuadRejectionReason } from "./frameDetection";

/**
 * One labeled image in the debug feature's step-by-step trail for a single
 * successful scan cycle (see DetectionLoopResult.debug's doc comment for
 * what's captured and why).
 *
 * `variant`, when set, picks a non-default CSS treatment for the rendered
 * `<figure>` — currently just `"edge-band"` (see buildEdgeBandSteps), whose
 * canvases are extreme long/thin strips that need different sizing rules
 * than the roughly-photo-shaped images every other kind of step produces.
 */
export interface DebugStep {
  label: string;
  canvas: HTMLCanvasElement;
  variant?: "edge-band";
}

/** A non-image entry in the debug trail: either a section heading or a
 * rejection explanation. */
export interface DebugNote {
  text: string;
  kind: "heading" | "rejection";
}

export type DebugEntry = DebugStep | DebugNote;

const EDGE_LABELS = ["Top edge", "Right edge", "Bottom edge", "Left edge"] as const;

const OVERLAY_STROKE_STYLE = "rgba(56, 224, 130, 0.95)";

/** A section heading, separating one stage's steps from another's in the
 * debug trail. */
export function debugStageHeading(text: string): DebugNote {
  return { text, kind: "heading" };
}

/** A human-readable explanation of why a frame's quad wasn't accepted. */
export function debugRejectionNote(reason: QuadRejectionReason): DebugNote {
  return { text: `Rejected: ${describeRejectionReason(reason)}`, kind: "rejection" };
}

/** The 4 edge-band strips, each with its fitted line drawn directly on top
 * (both still in the band-local coordinates they share), in
 * [top, right, bottom, left] order. `lines` entries may be `null` — a band
 * fitEdgeLine didn't find an edge in — in which case that step's strip is
 * shown with no line overlay and a "not detected" label, rather than
 * failing (used by the forced-debug-capture feature, which deliberately
 * shows both successes and failures for a single frame).
 *
 * Left/right bands are naturally tall and narrow (their thickness is the
 * width, their length along the edge is the height) — the *opposite* shape
 * from top/bottom's. `renderEdgeBandStep` rotates those 90° so every one of
 * the 4 previews reads with its long axis horizontal, and `variant:
 * "edge-band"` (see DebugStep's doc comment) gives them all one consistent,
 * legible sizing in the debug panel instead of each stretching to whatever
 * its own (wildly different) aspect ratio implies. */
export function buildEdgeBandSteps(
  bands: readonly [EdgeBandPixels, EdgeBandPixels, EdgeBandPixels, EdgeBandPixels],
  lines: readonly [FittedLine | null, FittedLine | null, FittedLine | null, FittedLine | null],
): DebugStep[] {
  const [topBand, rightBand, bottomBand, leftBand] = bands;
  const [topLine, rightLine, bottomLine, leftLine] = lines;
  const pairs: [EdgeBandPixels, FittedLine | null][] = [
    [topBand, topLine],
    [rightBand, rightLine],
    [bottomBand, bottomLine],
    [leftBand, leftLine],
  ];
  return pairs.map(([band, line], i) => {
    const label = line ? EDGE_LABELS[i]! : `${EDGE_LABELS[i]!} — not detected`;
    return { label, canvas: renderEdgeBandStep(band, line), variant: "edge-band" };
  });
}

/** The frame a quad was detected in, with its 4 corners drawn as a closed
 * polygon on top. Takes `sourceCanvas` straight from the same frame the
 * corners were computed against (`FrameEvaluation.accepted.frameCanvas`),
 * so the overlay always matches the frame it's drawn on rather than a
 * separately-grabbed one. */
export function buildQuadOverlayStep(
  sourceCanvas: HTMLCanvasElement,
  corners: readonly [Point, Point, Point, Point],
): DebugStep {
  const label = "Detected quad";
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = requireContext(canvas);

  ctx.drawImage(sourceCanvas, 0, 0);

  ctx.strokeStyle = OVERLAY_STROKE_STYLE;
  ctx.lineWidth = Math.max(2, sourceCanvas.width * 0.004);
  const [first, ...rest] = corners;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const corner of rest) {
    ctx.lineTo(corner.x, corner.y);
  }
  ctx.closePath();
  ctx.stroke();

  return { label, canvas };
}

/** One step per frame `captureFlattenedFrameBurst` attempted, labeled with
 * what happened to it — a captured (successfully flattened) frame shows
 * the flattened output; a rejected one shows the raw video snapshot it was
 * rejected from, with why. Order matches capture order (1-indexed in the
 * label, matching how a person would count "frame 1, frame 2, ..." rather
 * than a 0-indexed array position). */
export function buildBurstFrameSteps(entries: readonly BurstFrameDebugEntry[]): DebugStep[] {
  return entries.map((entry, i) => ({
    label:
      entry.outcome === "captured"
        ? `Burst frame ${i + 1}: captured`
        : `Burst frame ${i + 1}: rejected — ${describeRejectionReason(entry.outcome)}`,
    canvas: entry.canvas,
  }));
}

/** `blob:` object URLs (see canvasToObjectURL) created for the *current*
 * contents of the debug panel — tracked so `renderDebugSteps` can revoke
 * them right before replacing those contents, rather than leaking each
 * render's (potentially many, potentially multi-megabyte) image blobs for
 * the rest of the page's lifetime. */
let activeObjectURLs: string[] = [];

/** Replaces `panel`'s contents with `entries`, in the given order (top to
 * bottom, per the panel's column layout) — a mix of image steps and
 * headings/rejection notes. */
export function renderDebugSteps(panel: HTMLElement, entries: readonly DebugEntry[]): void {
  for (const url of activeObjectURLs) {
    URL.revokeObjectURL(url);
  }
  activeObjectURLs = [];
  panel.replaceChildren(...entries.map(toElement));
}

function isDebugNote(entry: DebugEntry): entry is DebugNote {
  return "text" in entry;
}

function toElement(entry: DebugEntry): HTMLElement {
  return isDebugNote(entry) ? toNoteElement(entry) : toFigure(entry);
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

/** Renders `step.canvas` as an `<img>` rather than inserting the canvas
 * element directly. A bare `<canvas>` isn't a resource the browser
 * recognizes as an image — right-click on one offers no "Open image in new
 * tab", and in most browsers no reliable "Save image as" either. An
 * `<img>` gets the standard browser image context menu for free, letting
 * the actual full-resolution pixels (this only changes how the same canvas
 * is *presented*, not its resolution or content) be inspected outside the
 * panel's small on-page preview.
 *
 * `img.src` starts as a `data:` URL (synchronous, so something shows up
 * immediately) and is swapped to a `blob:` object URL (see
 * canvasToObjectURL) as soon as one's ready. That swap matters, not just
 * tidiness: a full-resolution capture's `data:` URL can be tens of
 * megabytes of base64 text, long enough that browsers reliably fail to
 * navigate to it at all — exactly the "open image in new tab" this
 * function exists to support. A `blob:` URL has no such limit. The
 * short-lived `data:` placeholder is harmless since nothing needs to link
 * to *that* URL specifically before the swap happens. */
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
    if (!url) {
      return;
    }
    img.src = url;
    activeObjectURLs.push(url);
  });
  const figcaption = document.createElement("figcaption");
  figcaption.textContent = step.label;
  figure.append(img, figcaption);
  return figure;
}

function renderEdgeBandStep(band: EdgeBandPixels, line: FittedLine | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = band.width;
  canvas.height = band.height;
  const ctx = requireContext(canvas);

  const imageData = ctx.createImageData(band.width, band.height);
  for (let i = 0; i < band.data.length; i++) {
    const value = band.data[i]!;
    imageData.data[i * 4] = value;
    imageData.data[i * 4 + 1] = value;
    imageData.data[i * 4 + 2] = value;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  if (line) {
    drawLineAcrossBand(ctx, line, band.width, band.height);
  }

  // Left/right bands come out taller than wide — rotate them 90° so their
  // long (along-the-edge) axis is horizontal, matching top/bottom's own
  // natural shape (see buildEdgeBandSteps' doc comment).
  return canvas.height > canvas.width ? rotate90Clockwise(canvas) : canvas;
}

function rotate90Clockwise(source: HTMLCanvasElement): HTMLCanvasElement {
  const rotated = document.createElement("canvas");
  rotated.width = source.height;
  rotated.height = source.width;
  const ctx = requireContext(rotated);
  ctx.translate(rotated.width / 2, rotated.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return rotated;
}

/** Draws `line` extended far enough past its own sample point to cross the
 * whole band strip in both directions, since a FittedLine's point/direction
 * describe an infinite line, not a segment. */
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

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context for a debug step image.");
  }
  return ctx;
}
