import { initApp } from "./shell/app";
import { requireElement } from "./shell/dom";

// Entry point: hands off to src/shell/app.ts, which owns everything else
// (camera, guide overlay, Scan button, detection loop, capture) — see
// docs/plan/05-imperative-shell.md. A startup failure (e.g. invalid game
// data) is shown in the status line.

try {
  initApp();
} catch (error: unknown) {
  console.error(error);
  requireElement("status").textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
}
