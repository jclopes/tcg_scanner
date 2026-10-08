# Architecture

TCG Scanner runs entirely in the browser. There is no server, and nothing is fetched from the network at runtime: Tesseract.js's worker, WASM and language data are served from the app itself (`vite.config.ts` copies them into `public/tesseract/`).

## Layers

- **`src/core/`** — pure functions on plain data (pixel buffers, points, matrices): edge detection, geometry, perspective warps, text-line detection, OCR preprocessing, card matching, CSV, data validation. No DOM; unit-tested.
- **`src/shell/`** — browser code: camera, canvases, Tesseract.js, localStorage and the UI. It hands plain data to the core.
- **`index.html`** — markup and all CSS. Every color comes from the palette in `:root`; canvas drawing reads it too (`paletteColor`).

## Scan pipeline

`ScanSession` (`scanSession.ts`) runs one scan at a time:

1. **Camera** — at startup `listFullHdCameras` probes which cameras reach Full HD; `startCameraStream` opens the chosen one.
2. **Detection** — on every video frame, four thin bands around the on-screen guide are sampled (`FrameSampler`), an edge line is fitted in each (`fitEdgeLine`), and the lines are intersected into a quad that must be card-shaped (`evaluateFrameForQuad`).
3. **Burst** — after a hit, a few more frames are evaluated; the sharpest, most card-shaped one is kept (`selectBestFrame`).
4. **Flatten** — that frame's card is warped upright for display (`captureFlattenedCard`).
5. **Identify** — each configured region is warped straight from the camera frame (`regionWarpMatrix`); text regions are narrowed to their text line (`analyzeTextRows` / `analyzeTextColumns`), preprocessed (`prepareTextForOcr`) and OCR'd; a region's `extract_regex` keeps the part of the reading that is its value (`extractMatch`, e.g. `001` from `001/298`). The collector number is fuzzy-matched against the selected set (`rankCardIds`), and the set code is checked against the game's other sets (`closerSetPrints`).
6. **Pick** — the user taps the right match; the card is added to the list and scanning continues. Without a confident match, detection simply restarts.

The session's state is one of `stopped`, `starting`, `scanning`, `processing`, `captured` or `error`; `app.ts` maps each state to the page.

## Screens

A bottom tab bar (`screens.ts`) switches between:

- **Scan** — camera with the guide, card orientation and foil toggles, Start/Stop, the result and match buttons, session tags, the debug trail and the scanned-card list.
- **Settings** — camera, resolution, sound, debug mode.

Start Scan first opens a dialog to pick the game and set (`gameChoice.ts`). Leaving Scan stops a running scan.

## Game data

Each game is a folder in `src/data/games/<game>/`, bundled at build time and validated at startup (`gameConfig.ts`):

- `regions.json` — card orientations, foil support, and per orientation the regions to read, as mm boxes on the card. Every orientation needs the text regions `collector_number` and `set_code`. A text region lists the characters OCR may read (`allowed_chars_regex`) and can pick its value out of the reading (`extract_regex`).
- `sets.json` — each set's code, name, printed code and collector numbers.

## Browser storage

- `tcg-scanner:preferences` — camera, resolution, game, set, session tags and sound. Best-effort: missing or stale values fall back to defaults.
- `tcg-scanner:scanned-cards` — the scanned list. Corrupt data stops the app at startup with an error naming the entry and field; unavailable storage is shown in the list.

## Shell modules

- **Scan:** `scanSession`, `cameraDevices`, `cameraStream`, `detectionLoop`, `frameSampler`, `frameDetection`, `frameBurst`, `capture`, `identify`, `regionExtraction`, `ocr`, `hiResStill`
- **UI:** `app` (wiring), `screens`, `gameChoice`, `cardOptions`, `cameraSettings`, `sessionTags`, `guideFeedback`, `guideOverlay`, `identificationView`, `resultView`, `scannedCards`, `manualEntry`, `debugSteps`, `scanSounds`
- **Data:** `gameConfig`, `preferences`, `scannedCardStore`, `config`
- **Helpers:** `canvasUtils`, `dom`, `orientationWatcher`
