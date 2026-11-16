import {
  closestSetPrint,
  extractMatch,
  joinScoredChars,
  minConfidence,
  padRegion,
  prepareTextForOcr,
  rankCardIds,
  regionsFor,
  TEXT_SEARCH_PADDING_X_MM,
} from "../core";
import type { CardIdMatch, CardOrientation, ImageRegionConfig, ScoredChar, TextRegionConfig } from "../core";
import type { Worker as TesseractWorker } from "tesseract.js";
import type { AcceptedFrame } from "./frameDetection";
import { COLLECTOR_NUMBER_REGION, SET_CODE_REGION } from "./gameConfig";
import type { Game, GameSet, SetChoice } from "./gameConfig";
import { canvasPixels, grayscaleToCanvas } from "./canvasUtils";
import { recognizeRegion } from "./ocr";
import { fitCropToText, warpRegion } from "./regionExtraction";
import type { TextCropAnalysis } from "./regionExtraction";

/** How many best-matching collector numbers to suggest. */
const CARD_MATCH_SUGGESTION_COUNT = 3;

/** A text region's crop: `canvas` is fitted to its text within `searchCanvas`,
 * or `null` when no confident text line was found (OCR is skipped rather than
 * guessed on the raw search area). */
export interface TextRegionCrop {
  region: TextRegionConfig;
  searchCanvas: HTMLCanvasElement;
  analysis: TextCropAnalysis;
  canvas: HTMLCanvasElement | null;
}

/** An image region's crop: not OCR'd, so `canvas` is just the configured box,
 * same as `searchCanvas`. */
export interface ImageRegionCrop {
  region: ImageRegionConfig;
  searchCanvas: HTMLCanvasElement;
  analysis: null;
  canvas: HTMLCanvasElement;
}

export type RegionCrop = TextRegionCrop | ImageRegionCrop;

/** A text region's OCR: the preprocessed image Tesseract saw, what it read
 * (filtered to the allowed characters) and the part of that the region's
 * `extractRegex` keeps — the text identification uses. `chars` is that kept
 * part with each character's own confidence; `text`/`confidence` summarize
 * it (`confidence` is `chars`' weakest, see `minConfidence`), but a caller
 * that needs to adjust the reading once more context is known (e.g.
 * identifyCard, for a set's unrecognizable collector-number prefix) needs the
 * characters themselves. `skipped` when no confident text crop was found —
 * `read`/`text`/`chars` are empty rather than a misread of the raw search
 * area, and `confidence` is 0. */
export interface RegionOcr {
  canvas: HTMLCanvasElement;
  inverted: boolean;
  read: string;
  text: string;
  chars: ScoredChar[];
  skipped: boolean;
  confidence: number;
}

/** A region's crop plus its OCR — always together, since only text regions
 * are OCR'd: checking `ocr` narrows `crop` to a TextRegionCrop (with its
 * non-null `analysis`) or an ImageRegionCrop (with its always non-null
 * `canvas`). */
export type RegionResult = { crop: TextRegionCrop; ocr: RegionOcr } | { crop: ImageRegionCrop; ocr: null };

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
  /** The collector number region's row/column analysis, for telemetry. */
  collectorNumberAnalysis: TextCropAnalysis;
  /** Tesseract's own confidence in its collector-number reading (see
   * RegionOcr's `confidence`) — 0 when no confident crop was found to OCR. */
  collectorNumberConfidence: number;
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
  game: Game,
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
      const ocr = crop.canvas ? await recognizeCrop(worker, crop.canvas, region) : skippedOcr(crop.searchCanvas);
      regions.push({ crop, ocr });
    } else {
      const canvas = warpRegion(frame, cardOrientation, region);
      regions.push({ crop: { region, searchCanvas: canvas, analysis: null, canvas }, ocr: null });
    }
  }
  const collectorNumber = textRegionResult(regions, COLLECTOR_NUMBER_REGION, game.id);
  const setCodeText = textRegionResult(regions, SET_CODE_REGION, game.id).ocr.text;
  const set = setChoice === "autodetect" ? closestSetPrint(setCodeText, game.sets) : setChoice;
  const collectorNumberChars = trimToCollectorNumberLength(collectorNumber.ocr.chars, set);
  const collectorNumberText = joinScoredChars(collectorNumberChars);
  return {
    regions,
    collectorNumberText,
    setCodeText,
    set,
    matches: set === null ? [] : suggestCardIds(collectorNumberText, set),
    collectorNumberCrop: collectorNumber.crop.canvas ?? collectorNumber.crop.searchCanvas,
    collectorNumberAnalysis: collectorNumber.crop.analysis,
    collectorNumberConfidence: minConfidence(collectorNumberChars),
  };
}

/** Warps a text region's padded search area (its configured box is only
 * where to look) and narrows the crop to its text line. */
function extractTextRegion(frame: AcceptedFrame, cardOrientation: CardOrientation, region: TextRegionConfig): TextRegionCrop {
  const searchRegion = padRegion(region, { xMm: TEXT_SEARCH_PADDING_X_MM, yMm: region.searchPaddingYMm });
  const searchCanvas = warpRegion(frame, cardOrientation, searchRegion);
  const { canvas, analysis } = fitCropToText(searchCanvas);
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
  const filtered = await recognizeRegion(worker, prepared, region.allowedChars);
  const matched = extractMatch(filtered, region.extractRegex);
  return {
    canvas: prepared,
    inverted,
    read: joinScoredChars(filtered),
    text: joinScoredChars(matched),
    chars: matched,
    skipped: false,
    confidence: minConfidence(matched),
  };
}

/** No confident text crop was found: skip Tesseract rather than guess on the
 * raw search area, so downstream matching sees "" (no match) instead of a
 * misread. `canvas` is the raw search area, for the debug trail. */
function skippedOcr(searchCanvas: HTMLCanvasElement): RegionOcr {
  return { canvas: searchCanvas, inverted: false, read: "", text: "", chars: [], skipped: true, confidence: 0 };
}

/** `chars` trimmed to at most as many trailing characters as `set`'s
 * collector numbers *typically* have after their declared prefix (see
 * GameSet.collectorNumberPrefix) — drops however many leading characters OCR
 * produced for that prefix's unrecognizable glyph (could be 0, 1, or more:
 * Tesseract's `eng` model can't output it, so it's filtered away entirely
 * when its own guess isn't itself an allowed character, or kept as a
 * low-confidence stand-in otherwise). Unchanged when `set` is null
 * (Autodetect read no set code), it has no prefix, or `chars` already fits. */
export function trimToCollectorNumberLength(chars: readonly ScoredChar[], set: GameSet | null): ScoredChar[] {
  if (set === null || set.collectorNumberPrefix === "") {
    return [...chars];
  }
  const numberLength = modalNumberLength(set.collectorNumbers, set.collectorNumberPrefix.length);
  return chars.length > numberLength ? chars.slice(chars.length - numberLength) : [...chars];
}

/** The most common length `collectorNumbers`' entries have once `prefixLength`
 * characters are dropped from each — most sets are uniformly zero-padded
 * (e.g. "001".."298"), but a handful of real entries vary (e.g. Cyberpunk's
 * "005a"/"005b"), so this picks the length that actually represents the set
 * rather than requiring every entry to match (see parseSet, which doesn't
 * enforce uniformity for the same reason). */
function modalNumberLength(collectorNumbers: readonly string[], prefixLength: number): number {
  const counts = new Map<number, number>();
  for (const id of collectorNumbers) {
    const length = id.length - prefixLength;
    counts.set(length, (counts.get(length) ?? 0) + 1);
  }
  let modalLength = 0;
  let modalCount = -1;
  for (const [length, count] of counts) {
    if (count > modalCount) {
      modalLength = length;
      modalCount = count;
    }
  }
  return modalLength;
}

/** The result of the text region `label`, which parseGameOption guarantees. */
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
