import {
  analyzeTextColumns,
  analyzeTextRows,
  cardSizeMm,
  computePerspectiveTransform,
  extractGrayscaleRegion,
  REGION_PX_PER_MM,
  regionOutputSize,
  regionWarpMatrix,
} from "../core";
import type { CardPrintFormat, OpenCv, RegionConfig, TextColumnAnalysis, TextRowAnalysis } from "../core";
import { createCanvas, require2dContext } from "./canvasUtils";
import { warpWithMatrix } from "./capture";
import type { AcceptedFrame } from "./frameDetection";
import { orientationFromSize } from "./orientationWatcher";

/**
 * Warps `region` straight out of the camera frame the card was detected in,
 * upright and at REGION_PX_PER_MM, in a single interpolation (see
 * regionWarpMatrix) — no intermediate flattened or rotated card, each of which
 * would blur it further.
 */
export function warpRegion(
  cv: OpenCv,
  frame: AcceptedFrame,
  cardFormat: CardPrintFormat,
  region: RegionConfig,
): HTMLCanvasElement {
  const camera = orientationFromSize(frame.frameCanvas);
  const frameToCardMm = computePerspectiveTransform(cv, frame.corners, cardSizeMm(camera));
  const matrix = regionWarpMatrix(frameToCardMm, camera, cardFormat, region, REGION_PX_PER_MM);
  return warpWithMatrix(cv, frame.frameCanvas, matrix, regionOutputSize(region, REGION_PX_PER_MM));
}

/** Both text analyses of a search area; `columns` is null when no text rows
 * were found. */
export interface TextCropAnalysis {
  rows: TextRowAnalysis;
  columns: TextColumnAnalysis | null;
}

/**
 * Narrows a text region's search area to its text: rows from
 * `analyzeTextRows` (band plus margin, kept inside nearby horizontal lines),
 * then columns from `analyzeTextColumns` within those rows (merging character
 * runs up to `maxGapTextHeights` apart), copying that rectangle 1:1. When no text is found the whole search area is used.
 */
export function fitCropToText(
  searchCanvas: HTMLCanvasElement,
  maxGapTextHeights: number,
): { canvas: HTMLCanvasElement; analysis: TextCropAnalysis } {
  const { width, height } = searchCanvas;
  const rgba = require2dContext(searchCanvas).getImageData(0, 0, width, height);
  const gray = extractGrayscaleRegion(rgba, { origin: { x: 0, y: 0 }, size: { width, height } });
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
