import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Copies @techstark/opencv-js's ~13MB dist/opencv.js into public/opencv.js
 * so it's served as an ordinary static asset at one fixed URL, rather than
 * each of this app's 3 separate JS execution contexts (the main thread,
 * plus 2 independent module Web Workers) statically `import`-ing the
 * package and getting their own fully-inlined copy bundled in at build
 * time. Vite/Rolldown has no way to share a chunk between a worker's
 * isolated build and the main build, so that used to mean downloading the
 * same ~13MB library 3 times over on a production visit; see
 * src/loadOpenCv.ts (which actually loads this file, in all 3 contexts)
 * for the rest of that story. Runs on `buildStart`, so it applies to both
 * `vite`/`vite dev` and `vite build` — public/opencv.js itself is
 * generated, not committed (see .gitignore), so it always reflects
 * whatever version of the package is actually installed.
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

export default defineConfig({
  // HTTPS + listening on the LAN interface (not just localhost) so this can
  // be opened from a phone on the same network — required for camera access
  // (getUserMedia only works in a secure context, and a plain-HTTP LAN IP
  // doesn't count as one). basicSsl generates a self-signed cert on the fly;
  // the phone's browser will show a one-time "not private" warning to click
  // through.
  plugins: [copyOpenCvToPublic(), basicSsl()],
  server: {
    host: true,
  },
  test: {},
});
