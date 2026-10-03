# Phase 2 — Card Identification

## Goal

Given Phase 1's flattened, upright card image, identify the specific
card: extract labeled sub-regions at fixed physical (mm) positions on the
card, run OCR on each region, and validate the combined recognized text
against a local dataset of known cards for the selected game — entirely
client-side.

## Out of scope for this phase

- Persisting/cataloging identified cards (Phase 3).
- Supporting more than one identifier layout per game at once (e.g.
  different eras of the same game with different card-back layouts) —
  one config per game to start.
- Building or sourcing a real, comprehensive ID dataset — this phase
  defines the dataset's format; populating it for real games is separate,
  ongoing work. A hand-written test dataset is enough to validate the
  pipeline.
- Auto-detecting which game a card belongs to. The user selects the game
  before/during the scan (see UX flow) — Phase 2 does not attempt to
  infer it from the image.

## Physical card model

Reuses Phase 1's model unchanged: every card is 63mm × 88mm
(`STANDARD_CARD_WIDTH_MM` / `STANDARD_CARD_HEIGHT_MM`). Phase 1's
flattened output image represents exactly that physical area, so a
region's mm position on the card maps directly to a pixel rect on that
image (see Region Extraction).

## Region config format

One JSON config per game, listing named regions in mm coordinates
(origin at the card's top-left corner, matching the flattened output's
orientation):

```json
{
  "game": "pokemon-base-set",
  "card_orientation": ["portrait", "landscape"],
  "foil": true,
  "regions": {
    "portrait": [
      {
        "label": "collector_number",
        "type": "text",
        "allowed_chars_regex": "[A-Za-z0-9*\/\-]",
        "x_mm": 5,
        "y_mm": 80,
        "width_mm": 15,
        "height_mm": 5,
        "rotation_deg": -45
      },
      {
        "label": "set_symbol",
        "type": "image",
        "x_mm": 50,
        "y_mm": 80,
        "width_mm": 8,
        "height_mm": 8
      }
    ],
    "landscape": [
      {
        "label": "collector_number",
        "type": "text",
        "allowed_chars_regex": "[A-Za-z0-9*\/\-]",
        "x_mm": 75,
        "y_mm": 55,
        "width_mm": 10,
        "height_mm": 4
      }
    ]
  }
}
```

- `card_orientation` — the orientations the game's cards are printed in
  (`"portrait"`, `"landscape"`), the first being the default. The
  Portrait/Landscape toggle is shown only when there are both.
- `regions` — one list of regions per entry in `card_orientation` (no more,
  no fewer): a landscape card has its regions in different places than a
  portrait one, and its mm coordinates are on the card in that orientation.
  The list used is the one for the orientation selected when scanning.
- `foil` — whether the game has foil cards; shows the Foil toggle, and each
  scanned card records whether it was foil.
- `label` — identifies the region; also the key used to look up this
  region's recognized value in the ID dataset (see ID Validation).
- `type` — specifies how this region should be processed. `"text"` regions
  are OCR'd via Tesseract.js and their recognized text is matched against
  the dataset. `"image"` regions are extracted but not OCR'd this phase
  (see Open Questions) — they're captured for future use (e.g. template
  matching against known symbol images), not matched yet.
- `allowed_chars_regex` — required only for `type: "text"` regions. A POSIX
  regex pattern constraining Tesseract's output: only characters matching
  this pattern are kept after OCR, all others discarded. Example:
  `[A-Za-z0-9*\/\-]` allows letters, digits, asterisk, slash, and hyphen
  (common in collector numbers like `025/102`). Reduces OCR misreads by
  ignoring junk characters Tesseract may hallucinate outside the expected
  character set.
- `max_gap_text_heights` — optional, `type: "text"` only. The largest gap
  between characters, in text heights, still treated as the same line when
  fitting the crop horizontally. Set it tight (e.g. `0.5`) for single-word
  regions; omit it for text with spaces (default 1.5). See "Text-band
  fitting".
- `rotation_deg` — optional, defaults to `0` (unrotated) when omitted. The
  angle, in degrees, the region's printed content is rotated relative to
  upright on the flattened card image, counter-clockwise positive (e.g. a
  layout that prints its collector number diagonally in a corner badge,
  tilted clockwise as printed, is expressed here as a *negative* value).
  Region extraction rotates the *entire* flattened card clockwise by
  `rotation_deg` degrees (same numeric value and sign, unchanged) first,
  then crops `x_mm`/`y_mm`/`width_mm`/`height_mm`'s axis-aligned box out of
  that rotated card — rotate-then-crop, not crop-then-rotate. That means
  `x_mm`/`y_mm`/`width_mm`/`height_mm` describe the region's box on the
  card *as it looks after* `rotation_deg`'s rotation is applied, not on the
  original flattened output — a config author should rotate a reference
  card image by the same angle first, then measure the box directly on
  that rotated image, not try to bound the still-tilted content on the
  original. Rotate-then-crop matters, not just coordinate bookkeeping:
  cropping the original card's box first would have to bound a *tilted*
  rectangle of content, which pads the box out to that tilted rectangle's
  own (larger) axis-aligned bounding box — wasted corner space that reads
  as background noise to Tesseract. Rotating the whole card first means the
  target content is already upright by the time cropping happens, so the
  box can be tight around just that content. The rotated card is sized to
  its full rotated bounding box, centered, so no corner is clipped (see
  `regionWarpMatrix`, `src/core/regionWarp.ts`).
- For `type: "text"` regions the box is a **search area**, not the final
  crop: see "Text-band fitting" under OCR strategy.
- Config files live alongside the app (e.g. `src/data/games/<game>/regions.json`) and
  are selected by the `game` key, not auto-discovered from card content.

## ID dataset format

One JSON file per game, alongside its region config, listing known
cards as flat records keyed by the same region `label`s used for
`type: "text"` regions, plus a `name` field for a human-readable label
the app can display:

```json
[
  { "collector_number": "025/102", "name": "Pikachu" },
  { "collector_number": "004/102", "name": "Charmander" }
]
```

- Only regions with `type: "text"` participate in matching — `"image"`
  regions have no corresponding dataset field this phase.
- The dataset is hand-written for testing in this phase; production
  sourcing is out of scope (see Out of Scope).

## UX flow

1. The user selects a **game** before scanning — a new sticky selector
   alongside the existing card-orientation selector, following the same "set
   once, stays set across scans" pattern. The selected game determines
   which region config and ID dataset are loaded.
2. Phase 1 produces a flattened, upright, exactly on-ratio card image at
   the card's native size in the frame — for display only; regions are
   warped straight from the camera frame (step 3), not from this image.
3. **Region extraction**: each configured region's mm rect is mapped to a
   pixel rect (functional core — px-per-mm scale against the flattened
   image's actual pixel dimensions, which represent the full 63mm × 88mm
   card) and cropped out as its own image (imperative shell — for a region
   with `rotation_deg` set, by first rotating the whole flattened card
   clockwise by that many degrees, then cropping the pixel rect out of the
   *rotated* card — see `rotation_deg`'s doc above for why).
4. **OCR**: each `type: "text"` region's cropped image is run through
   Tesseract.js, producing raw recognized text per region. Characters
   outside that region's `allowed_chars_regex` are discarded.
5. **Normalization**: each `"text"` region's raw OCR text is normalized
   (trimmed, case-folded) before matching.
6. **Validation**: the normalized per-region text is compared against the
   dataset — a record matches only if *every* OCR'd region's normalized
   text exactly equals that record's corresponding field. The first
   (only, if the dataset is well-formed) matching record is the result.
7. Output: either the matched record (shown to the user, handed to
   Phase 3), or a "no match" state — surfaced to the user, who can retry
   the scan (e.g. if OCR misread a character) rather than the app
   guessing.

## OCR strategy

- **Tesseract.js**, running client-side (WASM), consistent with the
  project's client-only constraint (see 00-overview.md). No network
  calls, no server-side OCR service.
- Runs in a Web Worker — Tesseract.js supports this natively and it keeps
  OCR (which can take real time, unlike the fast per-frame detection
  loop) off the main thread, consistent with Phase 1's existing
  worker-based pattern for CPU-heavy work.
- Each region is OCR'd independently — regions are small, targeted crops
  (not full-card text extraction), which keeps Tesseract's job simple and
  fast per region rather than running full-page OCR and parsing structure
  out of it.
- `type: "text"` regions are OCR'd with Tesseract.js constrained by their
  `allowed_chars_regex` two ways, not one: as a `tessedit_char_whitelist`
  Tesseract itself recognizes against (see `tesseractWhitelistFor`,
  `src/shell/ocr.ts` — the regex is expanded into an explicit character
  list by testing it against the printable-ASCII range, since Tesseract's
  parameter wants a flat list, not a regex), and *also* as post-processing
  of the result via `filterAllowedChars`. Validated manually (against a
  real camera capture, not just clean reference art) that the whitelist
  does real work post-processing alone can't: it can only ever *delete*
  characters the regex rejects, so a region whose true character Tesseract
  misread as some entirely different, disallowed character (e.g. a `]`
  read as `)`) stays wrong no matter how it's filtered afterward — a
  whitelist instead keeps that wrong guess from being a candidate in the
  first place, forcing Tesseract to pick from the remaining, correct
  options. Both still run: the whitelist doesn't make `filterAllowedChars`
  redundant, just usually a no-op — a cheap backstop for whatever Tesseract
  still emits alongside the constrained run (e.g. incidental whitespace).
- **Single-pass region warp.** Each region is warped straight out of the
  selected camera frame by `warpRegion` (`src/shell/regionExtraction.ts`),
  one bicubic `cv.warpPerspective` with a matrix composed in core
  (`regionWarpMatrix`, `src/core/regionWarp.ts`): camera frame → card mm
  (the detected quad's perspective transform) → upright card → card rotated
  by `rotationDeg` → region box at `REGION_PX_PER_MM`. That is one
  interpolation from real camera pixels. The earlier pipeline had up to
  four: flatten the whole card, rotate the whole card, crop at a sub-pixel
  offset, then rescale for OCR, each blurring the text a little more. The
  flattened card (`captureFlattenedCard`) is now only used for display and
  debug.
- `REGION_PX_PER_MM` (26, `src/core/constants.ts`) is the density
  Tesseract's `eng` LSTM model reads best. It was found by sweeping real
  captures; both larger and smaller character sizes read worse. Regions are
  warped directly to it, so no separate OCR rescale step exists. It's a
  tuning parameter, not exhaustively validated.
- **OCR preprocessing** (`prepareForOcr`, `src/shell/ocrPreprocessing.ts`):
  grayscale, then inverted to dark-on-light when `isLightTextOnDark`
  (`src/core/textPolarity.ts`: the smaller Otsu class is the text) finds
  light text, then a bilateral filter (d=5), which is edge-preserving
  denoising. Chosen by comparing variants side by side on real captures:
  - bilateral read as well as warping at 1.5× density, at about the cost of
    no filtering;
  - median read about the same (bilateral was chosen);
  - 1.5× and 2× density helped the small set code but hurt the collector
    number, and an automatic density chosen from the text height didn't
    beat bilateral;
  - Otsu/adaptive binarization and unsharp-mask sharpening read worst.
- **Text-band fitting.** A text region's configured box is padded by
  `TEXT_SEARCH_PADDING_Y_MM` above and below and `TEXT_SEARCH_PADDING_X_MM`
  left and right (`padRegion`, `src/core/identification.ts`) and warped as a
  search area.
  `analyzeTextRows` (`src/core/textBand.ts`) then builds two row profiles:
  - glyph-stroke energy (mean horizontal gradient per row). The text band
    is the contiguous run of rows above
    `TEXT_BAND_ENERGY_THRESHOLD_FRACTION` of the min→max range around the
    strongest row. It only counts as text when that peak is at least
    `TEXT_BAND_MIN_PEAK_TO_BACKGROUND` × the median row. The gate is
    relative because real, blurry, oversampled crops have low absolute
    gradients: an earlier absolute threshold rejected every real capture.
  - horizontal-line energy (mean vertical gradient per row edge). A row
    edge is a line (e.g. a badge border) when it exceeds both
    `HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND` × the median and every
    horizontal edge inside the text band (the letters' own tops and
    bottoms).

  The crop's rows are the band plus a `TEXT_BAND_MARGIN_FRACTION` margin,
  kept between the nearest lines above and below it. Its columns come from
  `analyzeTextColumns`, a per-column stroke-energy profile (horizontal and
  vertical gradient) over the text rows. Runs of columns above
  `TEXT_COLUMN_ENERGY_THRESHOLD_FRACTION` of the
  `TEXT_COLUMN_REFERENCE_PERCENTILE` (90th percentile) column are grouped
  while the gaps stay within the region's
  `max_gap_text_heights` (default `DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS`,
  1.5), plus a `TEXT_COLUMN_MARGIN_TEXT_HEIGHTS` margin. Regions with spaces
  need the wide default: word gaps measured up to ~1.2 text heights. A
  single-word region should set a tight value, for example
  `collector_number: 0.5` (its character gaps measured 0.1–0.2). Otherwise
  nearby artwork gets merged in and read as bogus characters. The group
  with the most total stroke energy is taken as the text. Both the
  percentile reference and the energy vote guard against a narrow but very
  strong feature: the card's edge against the background once set the
  threshold (as the max) and won the seed (as the peak), which cropped the
  set code to just the edge. `fitCropToText`
  (`src/shell/regionExtraction.ts`) copies that rectangle 1:1. When no text is found, the whole search area is OCR'd. This is an
  expected outcome. The debug trail shows the search area next to both
  profiles and their thresholds. All `TEXT_*`/`HORIZONTAL_LINE_*` constants
  are starting guesses.

  Next option if this proves insufficient: morphological text localization
  (morphological gradient + horizontal closing + connected components).

## ID validation

- **Exact match only** — no fuzzy/edit-distance matching in this phase.
  A region whose OCR output doesn't exactly match any dataset record
  (after normalization) results in "no match," not a best-guess. This
  keeps the matching logic (and its correctness) simple and predictable;
  fuzzy matching is deferred (see Open Questions) rather than guessed at
  upfront.
- Matching is a pure function: `(regionResults, dataset) => CardRecord |
  null`, independently testable without any OCR or image processing.

## Architecture: functional core / imperative shell

**Functional core** — pure functions, unit-testable without a browser:

```ts
interface RegionConfig {
  label: string;
  type: "text" | "image";
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg?: number; // clockwise degrees to undo printed tilt; 0/omitted = upright
  allowedCharsRegex?: string; // required for type: "text"; POSIX regex constraining OCR output
}

function regionWarpMatrix(
  frameToCardMm: Matrix3x3, // perspective transform of the detected quad, in card mm
  camera: Orientation,
  cardOrientation: CardOrientation,
  region: RegionConfig,
  pxPerMm: number,
): Matrix3x3 { /* camera frame px -> region px */ }

function normalizeOcrText(raw: string): string { /* ... */ }

interface CardRecord {
  name: string;
  [regionLabel: string]: string; // OCR'd regions' matched values
}

function matchIdentifier(
  regionResults: Record<string, string>, // label -> normalized OCR text
  dataset: readonly CardRecord[],
): CardRecord | null { /* ... */ }
```

**Imperative shell** — browser I/O and side effects:

- Loading a game's region config + ID dataset JSON (fetch or bundled
  import) when the game selector changes.
- Warping each region straight out of the selected camera frame with
  `regionWarpMatrix`'s matrix (`warpRegion`), upright and at OCR density.
- The Tesseract.js worker wrapper: dispatching each region's cropped
  image for OCR and collecting recognized text.
- Wiring the game selector into the existing UI state machine, and
  displaying the match result (or "no match" with a retry affordance).

## Data contracts

```ts
type RegionType = "text" | "image";

interface RegionConfig {
  label: string;
  type: RegionType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg?: number; // clockwise degrees to undo printed tilt; 0/omitted = upright
  allowedCharsRegex?: string; // required for type: "text"; POSIX regex constraining OCR output
}

interface GameConfig {
  game: string;
  regions: RegionConfig[];
}

interface CardRecord {
  name: string;
  [regionLabel: string]: string;
}
```

## Open questions / risks

Not resolved by this plan — flagged for a decision before or during
implementation:

1. **Image regions are extracted but unused this phase.** `type:
   "image"` regions (e.g. a set icon) are cropped but not matched
   against anything — OCR doesn't apply to iconography. Image-based
   matching (template/feature matching against known symbols) is a
   plausible future extension, not designed here.
2. **Exact-match brittleness.** OCR misreads (especially on small,
   low-contrast printed text) will produce real "no match" results even
   for a correctly-scanned card. Whether to add fuzzy matching (and with
   what tolerance) is deferred until real OCR accuracy against real cards
   is observed — premature to design a tolerance without that data.
3. **Region config authoring.** There's no tooling proposed here for
   *creating* a region config (measuring mm offsets on a real card) —
   configs are hand-authored JSON. A visual config-builder tool is a
   plausible future need, not in scope now.
4. **OCR performance on low-end/mobile devices** is unvalidated — running
   Tesseract.js on multiple small regions per scan needs to stay fast
   enough not to make the identification step feel broken, but no
   concrete latency budget is set here.
5. **Dataset scale.** The exact-match dataset lookup as described is a
   linear scan (fine for a hand-written test dataset); a real, larger
   per-game dataset may need an indexed lookup — not a concern yet at
   test-dataset scale.

## Acceptance criteria

- A game can be selected before/during a scan, sticky across scans like
  the existing card-orientation selector.
- Given a flattened Phase 1 output and a game's region config, each
  configured region is correctly cropped from the expected mm position.
- `type: "text"` regions are OCR'd and their normalized text is
  compared against that game's bundled ID dataset.
- A card whose OCR'd regions exactly match a dataset record resolves to
  that record, displayed to the user.
- A card with no matching record (or unrecognized text) surfaces a clear
  "no match" state rather than silently failing or guessing.
