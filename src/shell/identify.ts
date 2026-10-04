import {
  closerSetPrints,
  padRegion,
  prepareTextForOcr,
  rankCardIds,
  regionsFor,
  TEXT_SEARCH_PADDING_X_MM,
  TEXT_SEARCH_PADDING_Y_MM,
} from "../core";
import type { CardIdMatch, CardOrientation, RegionConfig, TextRegionConfig } from "../core";
import type { Worker as TesseractWorker } from "tesseract.js";
import type { AcceptedFrame } from "./frameDetection";
import { COLLECTOR_NUMBER_REGION, SET_CODE_REGION } from "./gameConfig";
import type { GameOption, GameSet } from "./gameConfig";
import { canvasPixels, grayscaleToCanvas } from "./canvasUtils";
import { recognizeRegion } from "./ocr";
import { fitCropToText, warpRegion } from "./regionExtraction";
import type { TextCropAnalysis } from "./regionExtraction";

/** How many best-matching collector numbers to suggest. */
const CARD_MATCH_SUGGESTION_COUNT = 3;

/** One region warped out of the frame. For a text region `canvas` is the crop
 * fitted to its text within `searchCanvas`; for an image region both are the
 * configured box and `analysis` is null. */
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
  /** The OCR'd set code, and the game's sets whose printed code it reads
   * closer to than the selected set's (see closerSetPrints) — empty when the
   * selected set fits best. Only a warning; never fails identification. */
  setCode: { text: string; closerSets: GameSet[] };
  /** The collector number's fitted crop, in color (the image OCR read, before
   * its grayscale preprocessing). */
  collectorNumberCrop: HTMLCanvasElement;
}

/** Warps and OCRs `game`'s regions for `cardOrientation` out of `frame`, ranks
 * `set`'s collector numbers and checks the set code against the game's sets.
 * Null if `isCancelled()` turns true (checked between regions). */
export async function identifyCard(
  worker: TesseractWorker,
  frame: AcceptedFrame,
  cardOrientation: CardOrientation,
  game: GameOption,
  set: GameSet,
  isCancelled: () => boolean,
): Promise<Identification | null> {
  const regions: RegionResult[] = [];
  for (const region of regionsFor(game.config, cardOrientation)) {
    if (isCancelled()) {
      return null;
    }
    if (region.type === "text") {
      const crop = extractTextRegion(frame, cardOrientation, region);
      regions.push({ crop, ocr: await recognizeCrop(worker, crop.canvas, region) });
    } else {
      const canvas = warpRegion(frame, cardOrientation, region);
      regions.push({ crop: { region, searchCanvas: canvas, analysis: null, canvas }, ocr: null });
    }
  }
  const collectorNumber = textRegionResult(regions, COLLECTOR_NUMBER_REGION, game.id);
  const setCodeText = textRegionResult(regions, SET_CODE_REGION, game.id).ocr.text;
  return {
    regions,
    matches: rankCardIds(collectorNumber.ocr.text, set.collectorNumbers, CARD_MATCH_SUGGESTION_COUNT),
    setCode: { text: setCodeText, closerSets: closerSetPrints(setCodeText, set, game.sets) },
    collectorNumberCrop: collectorNumber.crop.canvas,
  };
}

/** Warps a text region's padded search area (its configured box is only
 * where to look) and narrows the crop to its text line. */
function extractTextRegion(frame: AcceptedFrame, cardOrientation: CardOrientation, region: TextRegionConfig): RegionCrop {
  const searchRegion = padRegion(region, { xMm: TEXT_SEARCH_PADDING_X_MM, yMm: TEXT_SEARCH_PADDING_Y_MM });
  const searchCanvas = warpRegion(frame, cardOrientation, searchRegion);
  const { canvas, analysis } = fitCropToText(searchCanvas, region.maxGapTextHeights);
  return { region: searchRegion, searchCanvas, analysis, canvas };
}

/** Preprocesses a text crop (prepareTextForOcr) and OCRs it. */
async function recognizeCrop(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  region: TextRegionConfig,
): Promise<RegionOcr> {
  const { gray, inverted } = prepareTextForOcr(canvasPixels(canvas));
  const prepared = grayscaleToCanvas(gray);
  const text = await recognizeRegion(worker, prepared, region.allowedCharsRegex);
  return { canvas: prepared, inverted, text };
}

/** The result of the text region `label`, which parseGame guarantees. */
function textRegionResult(
  regions: readonly RegionResult[],
  label: string,
  gameName: string,
): RegionResult & { ocr: RegionOcr } {
  const result = regions.find(({ crop }) => crop.region.label === label);
  if (!result?.ocr) {
    throw new Error(`Game "${gameName}" has no "${label}" text region.`);
  }
  return { ...result, ocr: result.ocr };
}
