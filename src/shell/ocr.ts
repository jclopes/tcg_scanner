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

/**
 * The region-crop pixel density (in pixels per physical mm of card) that
 * reads most reliably for Tesseract's `eng` LSTM model — not "as much
 * resolution as possible": that model appears to have its own preferred
 * character-size range, tied to what it was trained on, and feeding it
 * text *larger* than that hurts accuracy just as feeding it text smaller
 * does. Confirmed by sweeping target density against real camera captures
 * once `captureFlattenedCard` started oversampling its own output (see
 * FLATTEN_OVERSAMPLE_FACTOR, src/core/constants.ts): a region crop taken
 * directly from that oversampled flatten, with *no* further scaling, reads
 * *worse* than the same crop scaled back down to around this density —
 * despite the oversampled crop having strictly more real detail in it, not
 * less. 26 was the best balance found across two regions on two different
 * real captures; noisy at the single-pixel level like every OCR tuning
 * parameter in this file, not a value with a clean derivation.
 */
const OCR_TARGET_PX_PER_MM = 26;

/**
 * Scales `canvas` — one region's crop, at `currentPxPerMm` (that capture's
 * actual flattened density, e.g. `cardCanvas.width / STANDARD_CARD_WIDTH_MM`
 * — every region crop from the same capture shares this same density) —
 * to `OCR_TARGET_PX_PER_MM` before handing it to Tesseract. See that
 * constant's doc comment for why a *target density* rather than a fixed
 * multiplier: `captureFlattenedCard` now deliberately oversamples (see
 * FLATTEN_OVERSAMPLE_FACTOR), so a region crop usually needs scaling
 * *down* to reach the density that actually reads best, not up — the
 * opposite of what this function did (always upscale by a fixed factor)
 * before that change. Smooth (the browser's default `imageSmoothingEnabled`)
 * rather than nearest-neighbor: nearest-neighbor was the right choice for
 * the old always-upscale-a-tiny-blurry-crop case (see git history), where
 * the crop had no real detail to preserve and blocky-but-crisp beat
 * smoothed-into-more-blur; scaling down (the normal case now) is ordinary
 * downsampling of a genuinely detailed image, where smooth interpolation
 * is the standard, correct choice.
 */
function scaleForOcr(canvas: HTMLCanvasElement, currentPxPerMm: number): HTMLCanvasElement {
  const scaleFactor = OCR_TARGET_PX_PER_MM / currentPxPerMm;
  const scaled = document.createElement("canvas");
  scaled.width = Math.max(1, Math.round(canvas.width * scaleFactor));
  scaled.height = Math.max(1, Math.round(canvas.height * scaleFactor));
  const ctx = scaled.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to scale a region for OCR.");
  }
  // imageSmoothingEnabled is already true by default, but Canvas 2D's
  // *quality* default is "low", not "high" — silently blurrier/more
  // aliased resampling than intended for what's usually now a meaningful
  // downscale (see OCR_TARGET_PX_PER_MM's doc comment); see the equivalent
  // fix in regionExtraction.ts's require2dContext for the fuller story.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
  return scaled;
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
 * Runs `worker` against `regionCanvas` (one `type: "text"` region's cropped,
 * upright image — see `cropRegion` in regionExtraction.ts) and returns both
 * Tesseract's raw recognized text and, when `allowedCharsRegex` is given,
 * that text filtered down to only the characters it allows (see
 * `filterAllowedChars`). Both are returned (not just the filtered text) so
 * a caller/debug view can show what Tesseract actually saw versus what
 * survived filtering.
 *
 * `allowedCharsRegex`, when given, constrains recognition itself via
 * Tesseract's `tessedit_char_whitelist` (see `tesseractWhitelistFor`) *and*
 * still gets applied afterward via `filterAllowedChars` — not redundant:
 * validated manually against a real camera capture that the whitelist does
 * more than post-filtering alone can. A region whose true character wasn't
 * even a candidate Tesseract was choosing between (e.g. a `]` it kept
 * misreading as `)`/`}`, neither of which `filterAllowedChars` could ever
 * turn back into a `]` after the fact) got fixed once `)`/`}` were excluded
 * from what it was allowed to output at all, forcing it to pick from the
 * remaining, correct candidates instead. `filterAllowedChars` stays in
 * place as a cheap defense-in-depth backstop (e.g. for whatever Tesseract
 * still emits alongside the whitelisted run, such as a trailing space) —
 * removing it now that the whitelist does most of the work isn't warranted.
 *
 * `regionCanvas` is scaled to OCR_TARGET_PX_PER_MM first (see
 * `scaleForOcr`) — recognizing directly against a region crop at whatever
 * density the flatten happened to produce measurably hurts accuracy in
 * both directions, too small *and* too large (see OCR_TARGET_PX_PER_MM's
 * doc comment). `currentPxPerMm` is the flattened card's own actual
 * density (`cardCanvas.width / STANDARD_CARD_WIDTH_MM` — the same for
 * every region cropped from one capture, so a caller computes it once, not
 * per region).
 *
 * Sets `tessedit_pageseg_mode` to `SINGLE_LINE` before recognizing — every
 * region this phase's regions are small, single-line crops (a collector
 * number, a set code), not a full paragraph, so Tesseract's default "assume
 * a general page layout" mode is the wrong starting point. Validated
 * against the alternatives (SINGLE_BLOCK, SINGLE_WORD, RAW_LINE) in the
 * same manual sweep that picked OCR_TARGET_PX_PER_MM: SINGLE_WORD and
 * RAW_LINE consistently misread the crop's *first* character (e.g. "B" as
 * "8") regardless of preprocessing, which SINGLE_LINE and SINGLE_BLOCK
 * never did.
 *
 * Regions are recognized one at a time against a single shared worker
 * (see createOcrWorker's caller in app.ts) — `recognize()` calls against
 * one Tesseract.js worker are inherently sequential regardless, and
 * per-region init cost is zero (the expensive WASM/language-data load
 * already happened once, in createOcrWorker). Because the whitelist is a
 * `setParameters` call scoped to *this* worker for its *next* `recognize()`
 * call, it has to be set fresh before every region — a worker shared across
 * regions with different `allowedCharsRegex` would otherwise keep
 * whichever region's whitelist was set last.
 */
export async function recognizeRegion(
  worker: TesseractWorker,
  regionCanvas: HTMLCanvasElement,
  currentPxPerMm: number,
  allowedCharsRegex?: string,
): Promise<{ rawText: string; filteredText: string }> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: allowedCharsRegex ? tesseractWhitelistFor(allowedCharsRegex) : "",
  });
  const {
    data: { text },
  } = await worker.recognize(scaleForOcr(regionCanvas, currentPxPerMm));
  const rawText = text.trim();
  const filteredText = allowedCharsRegex ? filterAllowedChars(rawText, allowedCharsRegex) : rawText;
  return { rawText, filteredText };
}
