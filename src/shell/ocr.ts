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
 */
export async function createOcrWorker(): Promise<TesseractWorker> {
  return createWorker("eng", undefined, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang-data",
  });
}

/**
 * A region crop (a collector number, a set code) is a handful of
 * millimeters of printed card — at the flattened output's native
 * resolution, that's typically well under 100px on a side (e.g. ~80×35 for
 * a real camera capture at a typical negotiated resolution). Recognizing
 * at that native size measurably hurts accuracy — validated manually
 * against a real camera capture (not just clean reference card art): the
 * same crop read "B007," (wrong) at native size versus "B001," (correct
 * after `filterAllowedChars`) at 5×. 5× was the sweet spot found by sweeping
 * both scale factor and resampling filter against that same capture — small
 * enough to stay fast, large enough that Tesseract's LSTM model (trained on
 * ordinary-sized text) has enough pixels to work with. See REGION_OCR_SCALE.
 */
const REGION_OCR_SCALE = 5;

/**
 * Upscales `canvas` by `REGION_OCR_SCALE`× with nearest-neighbor sampling
 * (`imageSmoothingEnabled = false`) before handing it to Tesseract — see
 * REGION_OCR_SCALE's doc comment for why upscaling matters at all.
 * Nearest-neighbor specifically (as opposed to the browser's default
 * smooth/bilinear scaling) because it won a same manual sweep against a
 * real camera capture: it kept hard glyph edges crisp rather than
 * softening them into a blur, which is what actually matters for an LSTM
 * OCR model reading small stylized-font text, and every smooth filter
 * tried (bilinear-like and Lanczos-like) did measurably worse or no better
 * on the same test crops.
 */
function upscaleForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const upscaled = document.createElement("canvas");
  upscaled.width = canvas.width * REGION_OCR_SCALE;
  upscaled.height = canvas.height * REGION_OCR_SCALE;
  const ctx = upscaled.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to upscale a region for OCR.");
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, upscaled.width, upscaled.height);
  return upscaled;
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
 * `regionCanvas` is upscaled first (see upscaleForOcr) — recognizing
 * directly against the tiny native-resolution crop measurably hurts
 * accuracy (see REGION_OCR_SCALE's doc comment).
 *
 * Sets `tessedit_pageseg_mode` to `SINGLE_LINE` before recognizing — every
 * region this phase's regions are small, single-line crops (a collector
 * number, a set code), not a full paragraph, so Tesseract's default "assume
 * a general page layout" mode is the wrong starting point. Validated
 * against the alternatives (SINGLE_BLOCK, SINGLE_WORD, RAW_LINE) in the
 * same manual sweep that picked REGION_OCR_SCALE and upscaleForOcr's
 * resampling: SINGLE_WORD and RAW_LINE consistently misread the crop's
 * *first* character (e.g. "B" as "8") regardless of preprocessing, which
 * SINGLE_LINE and SINGLE_BLOCK never did.
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
  allowedCharsRegex?: string,
): Promise<{ rawText: string; filteredText: string }> {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: allowedCharsRegex ? tesseractWhitelistFor(allowedCharsRegex) : "",
  });
  const {
    data: { text },
  } = await worker.recognize(upscaleForOcr(regionCanvas));
  const rawText = text.trim();
  const filteredText = allowedCharsRegex ? filterAllowedChars(rawText, allowedCharsRegex) : rawText;
  return { rawText, filteredText };
}
