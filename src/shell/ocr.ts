import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";
import { filterAllowedChars } from "../core";

/**
 * A Tesseract.js worker that loads its script, WASM core and English data
 * from this app's origin (public/tesseract/, see vite.config.ts), not a CDN.
 * Tesseract's dictionaries ("dawgs") bias recognition toward English words,
 * which collector numbers and set codes aren't; they load with the language
 * data, so they can only be disabled here, not per `recognize()`.
 */
async function createOcrWorker(): Promise<TesseractWorker> {
  return createWorker(
    "eng",
    undefined,
    {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang-data",
    },
    {
      load_system_dawg: "0",
      load_freq_dawg: "0",
      load_punc_dawg: "0",
      load_number_dawg: "0",
      load_unambig_dawg: "0",
      load_bigram_dawg: "0",
    },
  );
}

/** Creates the OCR worker on first use and keeps it (expensive to start,
 * cheap to reuse) until `terminate()`; the next `get()` creates a new one. */
export class LazyOcrWorker {
  private worker: Promise<TesseractWorker> | null = null;

  get(): Promise<TesseractWorker> {
    this.worker ??= createOcrWorker();
    return this.worker;
  }

  terminate(): void {
    const worker = this.worker;
    this.worker = null;
    void worker?.then((w) => w.terminate());
  }
}

/** Printable ASCII: the `eng` model can't output anything else (not even
 * the "β" some collector numbers have). */
const WHITELIST_CANDIDATE_RANGE = { first: 0x20, last: 0x7e };

/** The characters `allowedCharsRegex` (a character class like "[B0-9]")
 * matches, as the explicit list `tessedit_char_whitelist` wants. */
function tesseractWhitelistFor(allowedCharsRegex: string): string {
  const regex = new RegExp(allowedCharsRegex);
  let whitelist = "";
  for (let code = WHITELIST_CANDIDATE_RANGE.first; code <= WHITELIST_CANDIDATE_RANGE.last; code++) {
    const char = String.fromCharCode(code);
    if (regex.test(char)) {
      whitelist += char;
    }
  }
  return whitelist;
}

/**
 * OCRs one upright text region, filtered to `allowedCharsRegex`. The regex is
 * also Tesseract's whitelist (worker-wide, so set per region), which keeps
 * misreads within it. SINGLE_LINE because SINGLE_WORD and RAW_LINE misread
 * the first character on real captures.
 */
export async function recognizeRegion(
  worker: TesseractWorker,
  regionCanvas: HTMLCanvasElement,
  allowedCharsRegex: string,
): Promise<string> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: tesseractWhitelistFor(allowedCharsRegex),
  });
  const {
    data: { text },
  } = await worker.recognize(regionCanvas);
  return filterAllowedChars(text.trim(), allowedCharsRegex);
}
