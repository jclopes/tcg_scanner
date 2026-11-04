import {
  analyzeTextColumns,
  analyzeTextRows,
  cardSizeMm,
  computePerspectiveTransform,
  extractGrayscaleRegion,
  REGION_PX_PER_MM,
  regionOutputSize,
  regionWarpMatrix,
  retryTextRows,
  TEXT_BAND_FALLBACK_MIN_PEAK_TO_BACKGROUND,
  TEXT_FALLBACK_MIN_SPIKES,
  warpPerspective,
} from "../core";
import type { CardOrientation, GrayscalePixels, RegionConfig, TextColumnAnalysis, TextRowAnalysis } from "../core";
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
 * within them. When the strict row band isn't found, retries once with
 * `analyzeFallbackBand`. `canvas` is `null` — reject rather than guess —
 * whenever either stage doesn't resolve to a crop, columns included: a row
 * band with no confident columns is as unusable as no band at all. */
export function fitCropToText(
  searchCanvas: HTMLCanvasElement,
  maxGapTextHeights: number,
): { canvas: HTMLCanvasElement | null; analysis: TextCropAnalysis } {
  const { width, height } = searchCanvas;
  const gray = extractGrayscaleRegion(canvasPixels(searchCanvas), { origin: { x: 0, y: 0 }, size: { width, height } });
  const strictRows = analyzeTextRows(gray);
  const { rows, columns } =
    strictRows.band && strictRows.crop
      ? { rows: strictRows, columns: analyzeTextColumns(gray, strictRows.band, maxGapTextHeights) }
      : (analyzeFallbackBand(strictRows, height, gray, maxGapTextHeights) ?? { rows: strictRows, columns: null });

  if (!rows.crop || !columns?.crop) {
    return { canvas: null, analysis: { rows, columns } };
  }

  const { left, right } = columns.crop;
  const { top, bottom } = rows.crop;
  const canvas = createCanvas({ width: right - left, height: bottom - top });
  require2dContext(canvas).drawImage(searchCanvas, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return { canvas, analysis: { rows, columns } };
}

/** A provisional row band from TEXT_BAND_FALLBACK_MIN_PEAK_TO_BACKGROUND's
 * looser threshold — reapplied to `strictRows`'s already-computed profiles,
 * not rescanned from `gray` — accepted only once its columns resolve to at
 * least TEXT_FALLBACK_MIN_SPIKES comparable spikes — a single decorative
 * feature (e.g. a watermark) still won't pass. Null when neither the band nor
 * that confirmation holds. */
function analyzeFallbackBand(
  strictRows: TextRowAnalysis,
  height: number,
  gray: GrayscalePixels,
  maxGapTextHeights: number,
): { rows: TextRowAnalysis; columns: TextColumnAnalysis } | null {
  const rows = retryTextRows(strictRows, height, TEXT_BAND_FALLBACK_MIN_PEAK_TO_BACKGROUND);
  if (!rows.band || !rows.crop) {
    return null;
  }
  const columns = analyzeTextColumns(gray, rows.band, maxGapTextHeights);
  return columns.spikeCount >= TEXT_FALLBACK_MIN_SPIKES ? { rows, columns } : null;
}
