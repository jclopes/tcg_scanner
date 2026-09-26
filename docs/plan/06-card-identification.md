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
  "regions": [
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
      "height_mm": 8,
      "rotation_deg": 0
    }
  ]
}
```

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
  box can be tight around just that content. The rotation itself matches
  Phase 1's `rotateCanvas` (`src/shell/capture.ts`), whose `degrees`
  parameter is also clockwise-positive — except `rotateCanvas` only accepts
  90°-multiples (all it's needed for so far) and never needs to grow its
  canvas as a result, whereas region extraction's arbitrary-angle rotation
  (`cropRegion`, `src/shell/regionExtraction.ts`) sizes the rotated card's
  canvas to its full rotated bounding box so no corner is clipped.
- Config files live alongside the app (e.g. `src/data/games/*.json`) and
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
   alongside the existing card-format selector, following the same "set
   once, stays set across scans" pattern. The selected game determines
   which region config and ID dataset are loaded.
2. Phase 1 produces a flattened, upright card image — deliberately
   oversampled and exactly on-ratio (see `FLATTEN_OVERSAMPLE_FACTOR`'s doc
   comment, `src/core/constants.ts`), a Phase 2 requirement Phase 1's own
   design didn't originally have (it used to size its output to the
   detected quad's raw measured extent — see git history), added here
   rather than as a separate step later, per "keep the transformations to
   a minimum."
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
- The flattened card a region is cropped from is itself deliberately
  oversampled (`captureFlattenedCard`, `src/shell/capture.ts`, targets
  `FLATTEN_OVERSAMPLE_FACTOR`× the detected quad's native measured size,
  not its native size directly — see that constant's doc comment,
  `src/core/constants.ts`) — every card-shaped transform between the raw
  camera frame and a region crop (the perspective warp itself, then each
  rotated region's own correction rotation) then runs against denser
  source data, instead of compounding blur across several lossy passes
  each done at native resolution before a single upscale at the very end
  (an earlier version of this pipeline's approach — see git history).
- Immediately before OCR, each region crop is then scaled *back down* to a
  fixed target density (`OCR_TARGET_PX_PER_MM`, `src/shell/ocr.ts`, ~26
  px/mm) — counterintuitively, Tesseract's `eng` LSTM model reads *worse*
  against the fully-oversampled crop than against the same crop scaled
  down to this density, despite the oversampled version having strictly
  more real detail; the model appears to have its own preferred character-
  size range from training, and exceeding it hurts just as falling short
  of it does. See `scaleForOcr`'s doc comment for the manual sweep (target
  density × page-segmentation mode) that picked this value, run against
  real camera captures. A tuning parameter like Phase 1's edge-detection
  constants (`src/core/constants.ts`) — a reasonable default from the
  cards tested so far, not exhaustively validated.

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

interface PixelRegion {
  label: string;
  type: RegionConfig["type"];
  rect: { origin: Point; size: Size }; // pixel coordinates, axis-aligned
  rotationDeg?: number; // carried through from RegionConfig, clockwise degrees
  allowedCharsRegex?: string; // carried through from RegionConfig for type: "text"
}

function computeRegionPixelRects(
  regions: readonly RegionConfig[],
  cardPixelSize: Size, // the flattened output image's own size
): PixelRegion[] { /* ... */ }

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
- Cropping each `PixelRegion`'s rect out of the flattened output canvas
  into its own canvas/`ImageBitmap`, then rotating that crop clockwise by
  `rotationDeg` (when set) so printed content is upright before OCR — the
  same clockwise `rotateCanvas` helper Phase 1 already uses
  (`src/shell/capture.ts`), reused rather than reimplemented.
- The Tesseract.js worker wrapper: dispatching each region's cropped
  image for OCR and collecting recognized text, analogous to how
  `src/workers/pool.ts` dispatches edge-band crops to the Phase 1 edge
  workers.
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
  the existing card-format selector.
- Given a flattened Phase 1 output and a game's region config, each
  configured region is correctly cropped from the expected mm position.
- `type: "text"` regions are OCR'd and their normalized text is
  compared against that game's bundled ID dataset.
- A card whose OCR'd regions exactly match a dataset record resolves to
  that record, displayed to the user.
- A card with no matching record (or unrecognized text) surfaces a clear
  "no match" state rather than silently failing or guessing.
