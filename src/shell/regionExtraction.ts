import {
  analyzeTextColumns,
  analyzeTextRows,
  cardSizeMm,
  computePerspectiveTransform,
  extractGrayscaleRegion,
  REGION_PX_PER_MM,
  regionOutputSize,
  regionWarpMatrix,
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

/** Narrows a text region's search area to its text line (rows, then columns
 * within them); the whole area when no text is found. */
export function fitCropToText(
  searchCanvas: HTMLCanvasElement,
  maxGapTextHeights: number,
): { canvas: HTMLCanvasElement; analysis: TextCropAnalysis } {
  const { width, height } = searchCanvas;
  const gray = extractGrayscaleRegion(canvasPixels(searchCanvas), { origin: { x: 0, y: 0 }, size: { width, height } });
  const rows = analyzeTextRows(gray);
  if (!rows.band || !rows.crop) {
    return { canvas: searchCanvas, analysis: { rows, columns: null } };
  }

  const columns = analyzeTextColumns(gray, rows.band, maxGapTextHeights);
  const { left, right } = columns.crop ?? { left: 0, right: width };
  const { top, bottom } = rows.crop;
  const canvas = createCanvas({ width: right - left, height: bottom - top });
  require2dContext(canvas).drawImage(searchCanvas, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return { canvas, analysis: { rows, columns } };
}
