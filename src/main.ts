import { initApp } from "./shell/app";
import { requireElement } from "./shell/dom";

// Entry point (see src/shell/app.ts). A startup failure, e.g. invalid game
// data, is shown in the status line.

try {
  initApp();
} catch (error: unknown) {
  console.error(error);
  requireElement("status").textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
}
