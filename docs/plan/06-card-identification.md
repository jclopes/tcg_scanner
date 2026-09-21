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
      "type": "number",
      "x_mm": 5,
      "y_mm": 80,
      "width_mm": 15,
      "height_mm": 5
    },
    {
      "label": "set_symbol",
      "type": "symbol",
      "x_mm": 50,
      "y_mm": 80,
      "width_mm": 8,
      "height_mm": 8
    }
  ]
}
```

- `label` — identifies the region; also the key used to look up this
  region's recognized value in the ID dataset (see ID Validation).
- `type` — a hint for how this region should be recognized. Only
  `"number"`, `"text"`, and `"symbol"` are defined for this phase.
  `"number"`/`"text"` are run through OCR (with `"number"` narrowing
  Tesseract's character whitelist to digits and common separators
  `/`-`.` — collector numbers are commonly printed like `025/102`).
  `"symbol"` regions are extracted but **not** OCR'd this phase (see Open
  Questions) — they're captured for future use, not matched yet.
- Config files live alongside the app (e.g. `src/data/games/*.json`) and
  are selected by the `game` key, not auto-discovered from card content.

## ID dataset format

One JSON file per game, alongside its region config, listing known
cards as flat records keyed by the same region `label`s used for OCR'd
(`"number"`/`"text"`) regions, plus a `name` field for a human-readable
label the app can display:

```json
[
  { "collector_number": "025/102", "name": "Pikachu" },
  { "collector_number": "004/102", "name": "Charmander" }
]
```

- Only regions with `type: "number"` or `type: "text"` participate in
  matching — `"symbol"` regions have no corresponding dataset field this
  phase.
- The dataset is hand-written for testing in this phase; production
  sourcing is out of scope (see Out of Scope).

## UX flow

1. The user selects a **game** before scanning — a new sticky selector
   alongside the existing card-format selector, following the same "set
   once, stays set across scans" pattern. The selected game determines
   which region config and ID dataset are loaded.
2. Phase 1 runs unchanged, producing a flattened, upright card image.
3. **Region extraction** (functional core): each configured region's mm
   rect is mapped to a pixel rect against the flattened image's actual
   pixel dimensions (which represent the full 63mm × 88mm card), and that
   pixel rect is cropped out as its own image.
4. **OCR**: each `"number"`/`"text"` region's cropped image is run
   through Tesseract.js, producing raw recognized text per region.
5. **Normalization**: each region's raw OCR text is normalized (trimmed,
   case-folded) before matching.
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
- `type: "number"` regions narrow Tesseract's recognition to a digit +
  separator character whitelist, reducing common misreads (e.g. `O`/`0`
  confusion) for the region types where the expected content is known
  upfront. `type: "text"` regions use Tesseract's default character set.

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
  type: "number" | "text" | "symbol";
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

interface PixelRegion {
  label: string;
  type: RegionConfig["type"];
  rect: { origin: Point; size: Size }; // pixel coordinates
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
  into its own canvas/`ImageBitmap`.
- The Tesseract.js worker wrapper: dispatching each region's cropped
  image for OCR and collecting recognized text, analogous to how
  `src/workers/pool.ts` dispatches edge-band crops to the Phase 1 edge
  workers.
- Wiring the game selector into the existing UI state machine, and
  displaying the match result (or "no match" with a retry affordance).

## Data contracts

```ts
type RegionType = "number" | "text" | "symbol";

interface RegionConfig {
  label: string;
  type: RegionType;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
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

1. **Symbol regions are extracted but unused this phase.** `type:
   "symbol"` regions (e.g. a set icon) are cropped but not matched
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
- `"number"`/`"text"` regions are OCR'd and their normalized text is
  compared against that game's bundled ID dataset.
- A card whose OCR'd regions exactly match a dataset record resolves to
  that record, displayed to the user.
- A card with no matching record (or unrecognized text) surfaces a clear
  "no match" state rather than silently failing or guessing.
