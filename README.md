# TCG Scanner

A browser-only trading card scanner. Point a camera at a card: the app detects it, reads its collector number and set code with OCR, and lets you pick the matching card. Scanned cards (with foil, orientation, quantity and tags) are kept in the browser and can be exported as CSV. There is no server component.

Each game is plain data in `src/data/games/<game>/`:

- `regions.json` — where the collector number and set code are printed, card orientations, foil support.
- `sets.json` — the game's sets, their printed set codes and collector numbers.

## Development

Requirements: Node.js 20+, and a browser with camera access (Chrome, Edge or Safari).

```sh
npm install
npm run dev     # https://localhost:5173
npm run dev:lan # same, also reachable on the LAN (e.g. from a phone)
npm test        # unit tests (add -- --watch for watch mode)
npm run clean   # delete generated files (dist/, public/tesseract/, Vite's cache)
npm run clean:all  # also delete node_modules (run npm install afterwards)
```

The dev server uses a self-signed certificate because browsers only allow camera access over HTTPS. To scan from a phone, run `npm run dev:lan`, open the LAN URL that Vite prints and accept the certificate warning.

## Production

```sh
npm run build   # type-check, then build the static site into dist/
npm run preview # optional: serve dist/ locally to check the build
```

`dist/` is a static site: upload it to any static host. It must be served over **HTTPS** (for camera access).

## Project layout

```
src/core/         Pure logic (geometry, edge detection, OCR text analysis, matching). Unit-tested.
src/shell/        Browser code: camera, UI, detection loop, OCR, scanned-card list.
src/data/games/   Per-game data, validated at startup.
index.html        Markup and CSS.
docs/             How the app works (architecture.md).
```

Put browser-free logic in `src/core` with tests, everything else in `src/shell`. See [DEVELOPMENT_PRINCIPLES.md](./DEVELOPMENT_PRINCIPLES.md).
