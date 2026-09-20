import cvModule from "@techstark/opencv-js";

// Minimal scaffolding entry point. This only proves the page loads and
// OpenCV.js initializes. Camera access, the Scan button, and the guide
// overlay belong to a later stage (see docs/plan/01-capture-and-detection.md).

const statusEl = document.getElementById("status");

function setStatus(text: string): void {
  console.log(text);
  if (statusEl) {
    statusEl.textContent = text;
  }
}

async function waitForOpenCv(): Promise<typeof cvModule> {
  if (cvModule instanceof Promise) {
    return cvModule;
  }
  if ((cvModule as { Mat?: unknown }).Mat) {
    return cvModule;
  }
  await new Promise<void>((resolve) => {
    (cvModule as { onRuntimeInitialized?: () => void }).onRuntimeInitialized = () => resolve();
  });
  return cvModule;
}

async function main(): Promise<void> {
  const cv = await waitForOpenCv();
  const buildInfo: string = cv.getBuildInformation();
  const versionLine = buildInfo
    .split("\n")
    .find((line: string) => line.includes("Version control"));
  setStatus(`OpenCV ready${versionLine ? ` (${versionLine.trim()})` : ""}`);
}

main().catch((error: unknown) => {
  console.error(error);
  setStatus("OpenCV failed to load — see console.");
});
