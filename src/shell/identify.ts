import {
  closestSetPrint,
  extractMatch,
  padRegion,
  prepareTextForOcr,
  rankCardIds,
  regionsFor,
  TEXT_SEARCH_PADDING_X_MM,
} from "../core";
import type { CardIdMatch, CardOrientation, RegionConfig, TextRegionConfig } from "../core";
import type { Worker as TesseractWorker } from "tesseract.js";
import type { AcceptedFrame } from "./frameDetection";
import { COLLECTOR_NUMBER_REGION, SET_CODE_REGION } from "./gameConfig";
import type { GameOption, GameSet, SetChoice } from "./gameConfig";
import { canvasPixels, grayscaleToCanvas } from "./canvasUtils";
import { recognizeRegion } from "./ocr";
import { fitCropToText, warpRegion } from "./regionExtraction";
import type { TextCropAnalysis } from "./regionExtraction";

/** How many best-matching collector numbers to suggest. */
const CARD_MATCH_SUGGESTION_COUNT = 2;

/** One region warped out of the frame. For a text region `canvas` is the crop
 * fitted to its text within `searchCanvas`; for an image region both are the
 * configured box and `analysis` is null. */
export interface RegionCrop {
  region: RegionConfig;
  searchCanvas: HTMLCanvasElement;
  analysis: TextCropAnalysis | null;
  canvas: HTMLCanvasElement;
}

/** A text region's OCR: the preprocessed image Tesseract saw, what it read
 * (filtered to the allowed characters) and the part of that the region's
 * `extractRegex` keeps — the text identification uses. */
export interface RegionOcr {
  canvas: HTMLCanvasElement;
  inverted: boolean;
  read: string;
  text: string;
}

/** A region's crop plus its OCR (null for image regions). */
export interface RegionResult {
  crop: RegionCrop;
  ocr: RegionOcr | null;
}

export interface Identification {
  regions: RegionResult[];
  /** The collector number and set code as OCR read them. */
  collectorNumberText: string;
  setCodeText: string;
  /** The set the collector numbers were ranked in: the chosen one, or under
   * Autodetect the one the set code reads closest to — null when Autodetect
   * read no set code (then there are no matches). */
  set: GameSet | null;
  /** The set's suggested collector numbers (see suggestCardIds). */
  matches: CardIdMatch[];
  /** The collector number's fitted crop, in color (the image OCR read, before
   * its grayscale preprocessing). */
  collectorNumberCrop: HTMLCanvasElement;
}

/** `set`'s collector numbers closest to the OCR'd one, best first. */
export function suggestCardIds(collectorNumberText: string, set: GameSet): CardIdMatch[] {
  return rankCardIds(collectorNumberText, set.collectorNumbers, CARD_MATCH_SUGGESTION_COUNT);
}

/** Warps and OCRs `game`'s regions for `cardOrientation` out of `frame`,
 * resolves `setChoice` to a set and suggests its collector numbers. Null if
 * `isCancelled()` turns true (checked between regions). */
export async function identifyCard(
  worker: TesseractWorker,
  frame: AcceptedFrame,
  cardOrientation: CardOrientation,
  game: GameOption,
  setChoice: SetChoice,
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
  const set = setChoice === "autodetect" ? closestSetPrint(setCodeText, game.sets) : setChoice;
  return {
    regions,
    collectorNumberText: collectorNumber.ocr.text,
    setCodeText,
    set,
    matches: set === null ? [] : suggestCardIds(collectorNumber.ocr.text, set),
    collectorNumberCrop: collectorNumber.crop.canvas,
  };
}

/** Warps a text region's padded search area (its configured box is only
 * where to look) and narrows the crop to its text line. */
function extractTextRegion(frame: AcceptedFrame, cardOrientation: CardOrientation, region: TextRegionConfig): RegionCrop {
  const searchRegion = padRegion(region, { xMm: TEXT_SEARCH_PADDING_X_MM, yMm: region.searchPaddingYMm });
  const searchCanvas = warpRegion(frame, cardOrientation, searchRegion);
  const { canvas, analysis } = fitCropToText(searchCanvas, region.maxGapTextHeights);
  return { region: searchRegion, searchCanvas, analysis, canvas };
}

/** Preprocesses a text crop (prepareTextForOcr), OCRs it and extracts the
 * region's value from the reading. */
async function recognizeCrop(
  worker: TesseractWorker,
  canvas: HTMLCanvasElement,
  region: TextRegionConfig,
): Promise<RegionOcr> {
  const { gray, inverted } = prepareTextForOcr(canvasPixels(canvas));
  const prepared = grayscaleToCanvas(gray);
  const read = await recognizeRegion(worker, prepared, region.allowedChars);
  return { canvas: prepared, inverted, read, text: extractMatch(read, region.extractRegex) };
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
