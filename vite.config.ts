import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Copies @techstark/opencv-js's ~13MB dist/opencv.js into public/opencv.js
 * so it's served as an ordinary static asset at one fixed URL: the main
 * thread and the 4 edge-detection workers all load it from there (see
 * src/loadOpenCv.ts), so it's downloaded once and then served from the HTTP
 * cache. Importing the package instead would inline a separate copy into the
 * main build and the worker build, since Vite can't share a chunk between
 * them. Runs on `buildStart`, for both `vite` and `vite build`;
 * public/opencv.js is generated, not committed (see .gitignore).
 */
function copyOpenCvToPublic(): Plugin {
  return {
    name: "copy-opencv-js-to-public",
    async buildStart() {
      const src = resolve(rootDir, "node_modules/@techstark/opencv-js/dist/opencv.js");
      const destDir = resolve(rootDir, "public");
      await mkdir(destDir, { recursive: true });
      await copyFile(src, resolve(destDir, "opencv.js"));
    },
  };
}

/**
 * Copies everything Tesseract.js needs to run entirely client-side — its
 * worker script, WASM core (LSTM-only, in each of its 3
 * SIMD/relaxed-SIMD/no-SIMD variants, so the browser's own runtime feature
 * detection in getCore.js can still pick the fastest one available), and
 * the English trained-data file — into public/tesseract/, same rationale
 * as copyOpenCvToPublic: served as ordinary same-origin static assets
 * instead of Tesseract.js's own default of fetching each of these from the
 * jsdelivr CDN at runtime (see src/shell/ocr.ts, which points createWorker
 * at these local paths instead of accepting that default).
 *
 * Only the `.wasm.js` + `.wasm` pair is copied per core variant, not the
 * plain `.js` ones tesseract.js-core also ships (an asm.js, non-WASM
 * fallback that src/worker-script/browser/getCore.js's corePath-as-directory
 * logic never actually requests — dead weight for this app's target
 * browsers, all of which support WASM). Only the LSTM engine's variants are
 * copied, not the (larger, unused) Legacy-engine ones — this app always
 * runs Tesseract.js with its default OEM.LSTM_ONLY (see plan's OCR
 * strategy), never OEM.TESSERACT_ONLY/COMBINED.
 *
 * Only the `eng` language's data is vendored — this phase's dataset/config
 * are hand-written test fixtures in English (see docs/plan/06-card-
 * identification.md); a real multi-language rollout would need this
 * extended, not a concern yet.
 */
function copyTesseractToPublic(): Plugin {
  return {
    name: "copy-tesseract-to-public",
    async buildStart() {
      const destDir = resolve(rootDir, "public/tesseract");
      await mkdir(resolve(destDir, "core"), { recursive: true });
      await mkdir(resolve(destDir, "lang-data"), { recursive: true });

      await copyFile(
        resolve(rootDir, "node_modules/tesseract.js/dist/worker.min.js"),
        resolve(destDir, "worker.min.js"),
      );

      const coreVariants = ["tesseract-core-lstm", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd-lstm"];
      for (const variant of coreVariants) {
        for (const ext of [".wasm.js", ".wasm"]) {
          await copyFile(
            resolve(rootDir, `node_modules/tesseract.js-core/${variant}${ext}`),
            resolve(destDir, `core/${variant}${ext}`),
          );
        }
      }

      await copyFile(
        resolve(rootDir, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
        resolve(destDir, "lang-data/eng.traineddata.gz"),
      );
    },
  };
}

export default defineConfig({
  // HTTPS + listening on the LAN interface (not just localhost) so this can
  // be opened from a phone on the same network — required for camera access
  // (getUserMedia only works in a secure context, and a plain-HTTP LAN IP
  // doesn't count as one). basicSsl generates a self-signed cert on the fly;
  // the phone's browser will show a one-time "not private" warning to click
  // through.
  plugins: [copyOpenCvToPublic(), copyTesseractToPublic(), basicSsl()],
  server: {
    host: true,
  },
  test: {},
});
