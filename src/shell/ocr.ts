import { createWorker, PSM } from "tesseract.js";
import type { Worker as TesseractWorker } from "tesseract.js";
import { filterAllowedChars } from "../core";

/**
 * Creates a ready-to-use Tesseract.js worker, configured to load its
 * worker script, WASM core, and English trained-data from this app's own
 * origin (public/tesseract/ — see vite.config.ts's copyTesseractToPublic
 * plugin) instead of Tesseract.js's own default of fetching each from the
 * jsdelivr CDN at runtime. Consistent with this app's client-only, no-
 * external-network-call constraint (see docs/plan/00-overview.md) and the
 * same reasoning src/loadOpenCv.ts already applies to OpenCV.js.
 *
 * Tesseract.js manages its own dedicated Web Worker internally (spawned
 * from `workerPath`) — this call resolves once that worker has loaded the
 * WASM core and English language data and is ready to `recognize()`, per
 * `createWorker`'s own contract. Defaults to `OEM.LSTM_ONLY` (Tesseract.js's
 * own default engine mode, not overridden here) — the Legacy engine's
 * assets aren't even vendored (see copyTesseractToPublic's doc comment).
 *
 * The `load_*_dawg` config disables every one of Tesseract's built-in
 * dictionaries ("dawgs" — system word list, frequent-words list,
 * punctuation patterns, number patterns, etc.) at load time. These act as
 * a language-model prior during LSTM decoding, biasing recognition toward
 * sequences that look like real English words/punctuation *even among
 * characters `tessedit_char_whitelist` already allows* — actively
 * counterproductive for this app's actual input (collector numbers, set
 * codes: structured alphanumeric strings, never real words). This has to
 * be set at init time via `createWorker`'s `config` argument, not
 * per-`recognize()` via `setParameters` — the dictionaries are loaded
 * together with the language data itself, not reconsulted per call.
 */
export async function createOcrWorker(): Promise<TesseractWorker> {
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

/** The printable-ASCII range `tesseractWhitelistFor` tests `allowedCharsRegex`
 * against — every character an OCR'd card region could plausibly contain
 * (letters, digits, punctuation); deliberately not the full Unicode range,
 * since Tesseract's `eng` model has no non-ASCII glyphs to whitelist in the
 * first place (see the plan's identification.ts doc comment on `RegionType`
 * for the Greek-beta case this matters for: the model can't output `β`
 * regardless, so there's nothing to gain testing it). */
const WHITELIST_CANDIDATE_RANGE = { first: 0x20, last: 0x7e };

/**
 * Converts a region's `allowedCharsRegex` (a character class like `"[B0-9]"`
 * — see RegionConfig's doc comment, src/core/identification.ts) into a flat
 * string of the individual characters it matches, suitable for Tesseract's
 * `tessedit_char_whitelist` parameter — which wants an explicit character
 * list, not a regex. Built by brute-force testing every printable-ASCII
 * character against the regex (cheap: at most ~95 `RegExp.test` calls) and
 * keeping the ones that match, rather than trying to parse/expand the regex
 * itself — sufficient because every `allowed_chars_regex` seen so far is a
 * plain character class, and future ones documented that way stay valid
 * input to this same brute-force test regardless of what's inside the
 * brackets.
 */
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
 * OCRs one upright text region (already at REGION_PX_PER_MM — see
 * warpRegion) and returns Tesseract's text filtered to `allowedCharsRegex`.
 *
 * `allowedCharsRegex` is used twice on purpose: as Tesseract's
 * `tessedit_char_whitelist`, so a misread can't land on a disallowed
 * character (e.g. `]` read as `)`), and again via `filterAllowedChars` as a
 * cheap backstop for anything else emitted (e.g. stray spaces).
 *
 * Page segmentation is SINGLE_LINE: every region is one short line.
 * SINGLE_WORD and RAW_LINE consistently misread the first character (e.g.
 * "B" as "8") on real captures.
 *
 * The whitelist is a worker-wide parameter, so it's set before every region.
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
