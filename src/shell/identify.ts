import {
  DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
  matchesSetPrint,
  padRegion,
  rankCardIds,
  TEXT_SEARCH_PADDING_X_MM,
  TEXT_SEARCH_PADDING_Y_MM,
} from "../core";
import type { CardIdMatch, CardPrintFormat, GameConfig, OpenCv, RegionConfig, TextRegionConfig } from "../core";
import type { Worker as TesseractWorker } from "tesseract.js";
import type { AcceptedFrame } from "./frameDetection";
import type { GameSet } from "./gameConfig";
import { recognizeRegion } from "./ocr";
import { prepareForOcr } from "./ocrPreprocessing";
import { fitCropToText, warpRegion } from "./regionExtraction";
import type { TextCropAnalysis } from "./regionExtraction";

/** The text region whose OCR is fuzzy-matched against the selected set's
 * collector numbers. */
const COLLECTOR_NUMBER_REGION_LABEL = "collector_number";

/** The text region whose OCR is checked against the selected set's printed
 * code. */
const SET_CODE_REGION_LABEL = "set_code";

/** How many best-matching collector numbers to suggest. */
const CARD_MATCH_SUGGESTION_COUNT = 3;

/** One region warped out of the camera frame. For a text region,
 * `searchCanvas` is the padded search area, `analysis` its text-row analysis
 * and `canvas` the fitted crop (the whole search area when no text was
 * found); for an image region both canvases are the configured box and
 * `analysis` is null. */
export interface RegionCrop {
  region: RegionConfig;
  searchCanvas: HTMLCanvasElement;
  analysis: TextCropAnalysis | null;
  canvas: HTMLCanvasElement;
}

/** A text region's OCR: the preprocessed image Tesseract saw and what it read. */
export interface RegionOcr {
  canvas: HTMLCanvasElement;
  inverted: boolean;
  text: string;
}

/** A region's crop plus its OCR (null for image regions). */
export interface RegionResult {
  crop: RegionCrop;
  ocr: RegionOcr | null;
}

export interface Identification {
  regions: RegionResult[];
  /** The set's collector numbers closest to the OCR'd collector number. */
  matches: CardIdMatch[];
  /** The OCR'd set code, and whether it reads as the set's printed code
   * (see matchesSetPrint). A mismatch is only a warning. */
  setCode: { text: string; matchesSet: boolean };
}

/**
 * Warps every region of `game` straight out of `frame` (text regions fitted
 * to their text line), OCRs the text regions, ranks `set`'s collector
 * numbers against the OCR'd collector number and checks the OCR'd set code
 * against the set's printed code. Stops between regions once
 * `isCancelled()` returns true; the caller must then discard the result.
 */
export async function identifyCard(
  cv: OpenCv,
  worker: TesseractWorker,
  frame: AcceptedFrame,
  cardFormat: CardPrintFormat,
  game: GameConfig,
  set: GameSet,
  isCancelled: () => boolean,
): Promise<Identification> {
  const regions: RegionResult[] = [];
  for (const region of game.regions) {
    if (isCancelled()) {
      break;
    }
    if (region.type === "text") {
      const crop = extractTextRegion(cv, frame, cardFormat, region);
      regions.push({ crop, ocr: await recognizeCrop(cv, worker, crop.canvas, region) });
    } else {
      const canvas = warpRegion(cv, frame, cardFormat, region);
      regions.push({ crop: { region, searchCanvas: canvas, analysis: null, canvas }, ocr: null });
    }
  }
  const setCodeText = regionText(game, regions, SET_CODE_REGION_LABEL);
  return {
    regions,
    matches: rankCardIds(
      regionText(game, regions, COLLECTOR_NUMBER_REGION_LABEL),
      set.collectorNumbers,
      CARD_MATCH_SUGGESTION_COUNT,
    ),
    setCode: { text: setCodeText, matchesSet: matchesSetPrint(setCodeText, set.print) },
  };
}

/** Warps a text region's padded search area (its configured box is only
 * where to look) and narrows the crop to its text line. */
function extractTextRegion(cv: OpenCv, frame: AcceptedFrame, cardFormat: CardPrintFormat, region: TextRegionConfig): RegionCrop {
  const searchRegion = padRegion(region, { xMm: TEXT_SEARCH_PADDING_X_MM, yMm: TEXT_SEARCH_PADDING_Y_MM });
  const searchCanvas = warpRegion(cv, frame, cardFormat, searchRegion);
  const { canvas, analysis } = fitCropToText(
    searchCanvas,
    region.maxGapTextHeights ?? DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
  );
  return { region: searchRegion, searchCanvas, analysis, canvas };
}

/** Preprocesses a text crop (prepareForOcr) and OCRs it. */
async function recognizeCrop(
  cv: OpenCv,
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  region: TextRegionConfig,
): Promise<RegionOcr> {
  const prepared = prepareForOcr(cv, canvas);
  const text = await recognizeRegion(worker, prepared.canvas, region.allowedCharsRegex);
  return { canvas: prepared.canvas, inverted: prepared.inverted, text };
}

/** The OCR'd text of the text region `label`. Throws if `game` has no such
 * text region; "" if identification was cancelled before reaching it. */
function regionText(game: GameConfig, regions: readonly RegionResult[], label: string): string {
  if (!game.regions.some((region) => region.label === label && region.type === "text")) {
    throw new Error(`Game "${game.game}" has no "${label}" text region.`);
  }
  return regions.find(({ crop }) => crop.region.label === label)?.ocr?.text ?? "";
}
