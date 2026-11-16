import { createWorker, PSM } from "tesseract.js";
import type { Page as TesseractPage, Worker as TesseractWorker } from "tesseract.js";
import { filterAllowedChars } from "../core";
import type { ScoredChar } from "../core";

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
const PRINTABLE_ASCII = { first: 0x20, last: 0x7e };

/** The characters of `allowedChars` the `eng` model can output, as
 * `tessedit_char_whitelist`. */
function tesseractWhitelistFor(allowedChars: string): string {
  return [...allowedChars]
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return code >= PRINTABLE_ASCII.first && code <= PRINTABLE_ASCII.last;
    })
    .join("");
}

/**
 * OCRs one upright text region, filtered to `allowedChars`. They're also
 * Tesseract's whitelist (worker-wide, so set per region), which keeps
 * misreads within them. SINGLE_LINE because SINGLE_WORD and RAW_LINE misread
 * the first character on real captures. Returns each kept character with
 * Tesseract's own confidence in it (0-100: its internal certainty, not a
 * calibrated probability of being correct — and narrowing `allowedChars`
 * tends to inflate it, since it removes hypotheses Tesseract would otherwise
 * be weighing) — a caller that narrows further (e.g. `extractMatch`, to only
 * part of the reading) keeps the confidence of exactly the characters it uses.
 */
export async function recognizeRegion(
  worker: TesseractWorker,
  regionCanvas: HTMLCanvasElement,
  allowedChars: string,
): Promise<ScoredChar[]> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: tesseractWhitelistFor(allowedChars),
  });
  // blocks defaults to false — symbol-level confidence only comes with it.
  const { data } = await worker.recognize(regionCanvas, {}, { blocks: true });
  return filterAllowedChars(trimScoredChars(symbolChars(data)), allowedChars);
}

/** `page`'s recognized characters in reading order, each with its own
 * confidence — a space (`confidence: null`: it's inferred from word
 * boundaries, not itself recognized, so it's excluded from `minConfidence`
 * rather than counted as a maximally-confident character) is inserted
 * between words so multi-word regions (e.g. a set code's "MS01 - WNC [A]")
 * read back correctly. */
function symbolChars(page: TesseractPage): ScoredChar[] {
  const words = (page.blocks ?? []).flatMap((b) => b.paragraphs).flatMap((p) => p.lines).flatMap((l) => l.words);
  const chars: ScoredChar[] = [];
  for (const word of words) {
    if (chars.length > 0) {
      chars.push({ char: " ", confidence: null });
    }
    for (const symbol of word.symbols) {
      chars.push({ char: symbol.text, confidence: symbol.confidence });
    }
  }
  return chars;
}

/** `chars` with leading and trailing whitespace characters dropped. */
function trimScoredChars(chars: readonly ScoredChar[]): ScoredChar[] {
  let start = 0;
  let end = chars.length;
  while (start < end && /\s/.test(chars[start]!.char)) {
    start++;
  }
  while (end > start && /\s/.test(chars[end - 1]!.char)) {
    end--;
  }
  return chars.slice(start, end);
}
