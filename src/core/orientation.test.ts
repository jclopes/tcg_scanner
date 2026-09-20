import { describe, expect, it } from "vitest";
import { computeOutputRotationDegrees } from "./orientation";

describe("computeOutputRotationDegrees", () => {
  // Full branch coverage: all 4 combinations of the two 2-value enums.
  it("returns 0 when camera and card are both portrait", () => {
    expect(computeOutputRotationDegrees("portrait", "portrait")).toBe(0);
  });

  it("returns 0 when camera and card are both landscape", () => {
    expect(computeOutputRotationDegrees("landscape", "landscape")).toBe(0);
  });

  it("returns 90 when a landscape card is scanned on a portrait camera", () => {
    expect(computeOutputRotationDegrees("portrait", "landscape")).toBe(90);
  });

  it("returns 90 when a portrait card is scanned on a landscape camera", () => {
    expect(computeOutputRotationDegrees("landscape", "portrait")).toBe(90);
  });

  it("uses the same rotation for both mismatch directions (one consistent rule)", () => {
    const mismatchA = computeOutputRotationDegrees("portrait", "landscape");
    const mismatchB = computeOutputRotationDegrees("landscape", "portrait");
    expect(mismatchA).toBe(mismatchB);
  });

  /**
   * Rotates a small pixel grid clockwise by a multiple of 90 degrees, via an
   * explicit, from-scratch index transform (deliberately independent of any
   * rendering library) — used only to empirically verify the rotation
   * *direction* below, rather than trust the symbolic "left -> top" claim in
   * orientation.ts's doc comment on its own. Physically rotating an image 90
   * degrees clockwise moves the pixel at (x, y) to (newWidth - 1 - y, x) in
   * the rotated result.
   */
  function rotateClockwise(
    grid: readonly number[],
    width: number,
    height: number,
    degrees: number,
  ): { grid: number[]; width: number; height: number } {
    const steps = (((degrees / 90) % 4) + 4) % 4;
    let w = width;
    let h = height;
    let g = grid;
    for (let s = 0; s < steps; s++) {
      const newW = h;
      const newH = w;
      const newG = new Array<number>(newW * newH);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const nx = newW - 1 - y;
          const ny = x;
          newG[ny * newW + nx] = g[y * w + x]!;
        }
      }
      g = newG;
      w = newW;
      h = newH;
    }
    return { grid: g as number[], width: w, height: h };
  }

  it("empirically rotates a mismatched combo's raw-convention left edge onto the top (upright)", () => {
    // Represents the raw (unrotated) flattened output under the plan's
    // raw-capture placement convention: for a mismatched combo, the guide's
    // on-screen instructions always teach the user to place the card so its
    // own top edge faces the LEFT of the camera view — so mark the LEFT
    // column here, and verify the correction rotation moves it to the TOP
    // (i.e. the output is presented upright, per UX flow step 6), not that
    // it stays on/moves to some other edge.
    const width = 6;
    const height = 4;
    const rawFlattenedOutput = new Array<number>(width * height).fill(0);
    for (let y = 0; y < height; y++) {
      rawFlattenedOutput[y * width + 0] = 1;
    }

    const degrees = computeOutputRotationDegrees("portrait", "landscape");
    expect(degrees).not.toBe(0); // sanity: this combo is a mismatch

    const rotated = rotateClockwise(rawFlattenedOutput, width, height, degrees);

    const topRow = Array.from({ length: rotated.width }, (_, x) => rotated.grid[0 * rotated.width + x]);
    const bottomRow = Array.from(
      { length: rotated.width },
      (_, x) => rotated.grid[(rotated.height - 1) * rotated.width + x],
    );

    expect(topRow.every((v) => v === 1)).toBe(true);
    expect(bottomRow.every((v) => v === 1)).toBe(false);
  });
});
