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

/** Copies Tesseract.js's worker, its LSTM-only core (3 variants, so
 * getCore.js can pick the fastest the browser supports; each embeds its WASM)
 * and the English data into public/tesseract/ on every dev/build start, so
 * they're served from this app's origin instead of a CDN. */
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
  // HTTPS: camera access needs a secure context, which a plain-HTTP LAN
  // address (`npm run dev:lan`, e.g. from a phone) isn't. The dev server
  // exposes the whole project, so it stays on localhost unless --host.
  plugins: [copyTesseractToPublic(), basicSsl()],
});
