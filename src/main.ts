import { loadOpenCv } from "./loadOpenCv";
import { initApp } from "./shell/app";

// Entry point: waits for OpenCV.js to initialize, then hands off to
// src/shell/app.ts, which owns everything else (camera, guide overlay,
// Scan button, detection loop, capture) — see
// docs/plan/05-imperative-shell.md.

const statusEl = document.getElementById("status");

function setStatus(text: string): void {
  console.log(text);
  if (statusEl) {
    statusEl.textContent = text;
  }
}

async function main(): Promise<void> {
  const cv = await loadOpenCv();
  setStatus("Starting camera…");
  initApp(cv);
}

main().catch((error: unknown) => {
  console.error(error);
  setStatus("OpenCV failed to load — see console.");
});
