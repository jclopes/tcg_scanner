import {
  analyzeTextColumns,
  analyzeTextRows,
  cardSizeMm,
  computePerspectiveTransform,
  extractGrayscaleRegion,
  REGION_PX_PER_MM,
  regionOutputSize,
  regionWarpMatrix,
  TEXT_MIN_SPIKES,
  warpPerspective,
} from "../core";
import type { CardOrientation, RegionConfig, TextColumnAnalysis, TextRowAnalysis } from "../core";
import { canvasPixels, createCanvas, pixelsToCanvas, require2dContext } from "./canvasUtils";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";

/** `region` warped upright at REGION_PX_PER_MM straight from the camera frame
 * in one bicubic pass: every extra resampling would blur the text. */
export function warpRegion(frame: AcceptedFrame, cardOrientation: CardOrientation, region: RegionConfig): HTMLCanvasElement {
  const camera = orientationFromSize(frame.pixels);
  const frameToCardMm = computePerspectiveTransform(frame.corners, cardSizeMm(camera));
  const matrix = regionWarpMatrix(frameToCardMm, camera, cardOrientation, region, REGION_PX_PER_MM);
  return pixelsToCanvas(warpPerspective(frame.pixels, matrix, regionOutputSize(region, REGION_PX_PER_MM), "bicubic"));
}

/** Both text analyses of a search area; `columns` is null when no text rows
 * were found. */
export interface TextCropAnalysis {
  rows: TextRowAnalysis;
  columns: TextColumnAnalysis | null;
}

/** Narrows a text region's search area to its text line, rows then columns
 * within them. `canvas` is `null` — reject rather than guess — unless a row
 * band is found, its columns resolve to a crop, and that crop clears
 * TEXT_MIN_SPIKES: a row peak or a column crop alone can't tell real text
 * from a single decorative feature (e.g. a watermark). */
export function fitCropToText(searchCanvas: HTMLCanvasElement): { canvas: HTMLCanvasElement | null; analysis: TextCropAnalysis } {
  const { width, height } = searchCanvas;
  const gray = extractGrayscaleRegion(canvasPixels(searchCanvas), { origin: { x: 0, y: 0 }, size: { width, height } });
  const rows = analyzeTextRows(gray);
  const columns = rows.band ? analyzeTextColumns(gray, rows.band) : null;

  if (!rows.crop || !columns?.crop || columns.spikeCount < TEXT_MIN_SPIKES) {
    return { canvas: null, analysis: { rows, columns } };
  }

  const { left, right } = columns.crop;
  const { top, bottom } = rows.crop;
  const canvas = createCanvas({ width: right - left, height: bottom - top });
  require2dContext(canvas).drawImage(searchCanvas, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return { canvas, analysis: { rows, columns } };
}
