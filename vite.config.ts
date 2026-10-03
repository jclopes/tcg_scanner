import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

/** The folder of package `name`, found the way Node would load it from the
 * file `from` — so a dependency of a dependency is found wherever npm put it. */
function packageDir(name: string, from: string = fileURLToPath(import.meta.url)): string {
  return dirname(createRequire(from).resolve(`${name}/package.json`));
}

/**
 * Copies what Tesseract.js needs to run entirely client-side into
 * public/tesseract/, so it's served from this app's own origin instead of
 * Tesseract.js's default jsdelivr CDN (see src/shell/ocr.ts):
 * - its worker script;
 * - the LSTM-only core in its 3 variants (SIMD, relaxed SIMD, plain), so
 *   getCore.js can pick the fastest the browser supports. Each `.wasm.js`
 *   embeds its WASM, so the separate `.wasm` files are never requested and
 *   aren't copied;
 * - the English trained data.
 *
 * Runs on `buildStart`, for both `vite` and `vite build`; public/tesseract/ is
 * generated, not committed (see .gitignore).
 */
function copyTesseractToPublic(): Plugin {
  return {
    name: "copy-tesseract-to-public",
    async buildStart() {
      const tesseractDir = packageDir("tesseract.js");
      const coreDir = packageDir("tesseract.js-core", resolve(tesseractDir, "package.json"));
      const langDir = packageDir("@tesseract.js-data/eng");
      const destDir = resolve(rootDir, "public/tesseract");
      await mkdir(resolve(destDir, "core"), { recursive: true });
      await mkdir(resolve(destDir, "lang-data"), { recursive: true });

      await copyFile(
        resolve(tesseractDir, "dist/worker.min.js"),
        resolve(destDir, "worker.min.js"),
      );

      for (const variant of ["tesseract-core-lstm", "tesseract-core-simd-lstm", "tesseract-core-relaxedsimd-lstm"]) {
        await copyFile(
          resolve(coreDir, `${variant}.wasm.js`),
          resolve(destDir, `core/${variant}.wasm.js`),
        );
      }

      await copyFile(
        resolve(langDir, "4.0.0_best_int/eng.traineddata.gz"),
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
  plugins: [copyTesseractToPublic(), basicSsl()],
  server: {
    host: true,
  },
});
