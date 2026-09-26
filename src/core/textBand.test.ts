import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS, TEXT_BAND_MARGIN_FRACTION, TEXT_COLUMN_MARGIN_TEXT_HEIGHTS } from "./constants";
import { analyzeTextColumns, analyzeTextRows, withMargin } from "./textBand";
import type { GrayscalePixels } from "./types";

interface TextLine {
  top: number;
  bottom: number;
  ink: number;
}

/** A `width` x `height` image of `background`. Each text line gets 1px
 * vertical bars of `ink` every other column (a stand-in for glyph strokes)
 * on rows `[top, bottom)`; each border row is a solid row of `ink`. */
function image(
  width: number,
  height: number,
  { lines = [], borders = [], background = 255 }: { lines?: TextLine[]; borders?: { row: number; ink: number }[]; background?: number },
): GrayscalePixels {
  const data = new Uint8ClampedArray(width * height).fill(background);
  for (const { top, bottom, ink } of lines) {
    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < width; x += 2) {
        data[y * width + x] = ink;
      }
    }
  }
  for (const { row, ink } of borders) {
    data.fill(ink, row * width, (row + 1) * width);
  }
  return { data, width, height };
}

describe("analyzeTextRows", () => {
  it("finds the rows of a single text line", () => {
    const analysis = analyzeTextRows(image(40, 30, { lines: [{ top: 10, bottom: 20, ink: 0 }] }));
    expect(analysis.band).toEqual({ top: 10, bottom: 20 });
  });

  it("finds light-on-dark text the same way", () => {
    const analysis = analyzeTextRows(image(40, 30, { lines: [{ top: 5, bottom: 12, ink: 255 }], background: 0 }));
    expect(analysis.band).toEqual({ top: 5, bottom: 12 });
  });

  it("finds low-contrast text, since the gate is relative to the background", () => {
    const analysis = analyzeTextRows(image(40, 30, { lines: [{ top: 10, bottom: 20, ink: 235 }] }));
    expect(analysis.band).toEqual({ top: 10, bottom: 20 });
  });

  it("finds no text in a uniform area", () => {
    const analysis = analyzeTextRows(image(40, 30, {}));
    expect(analysis.band).toBeNull();
    expect(analysis.crop).toBeNull();
  });

  it("finds no text when every row has the same texture", () => {
    const analysis = analyzeTextRows(image(40, 30, { lines: [{ top: 0, bottom: 30, ink: 0 }] }));
    expect(analysis.band).toBeNull();
  });

  it("picks the strongest of two separate lines", () => {
    const analysis = analyzeTextRows(
      image(40, 40, {
        lines: [
          { top: 3, bottom: 8, ink: 180 },
          { top: 20, bottom: 30, ink: 0 },
        ],
      }),
    );
    expect(analysis.band).toEqual({ top: 20, bottom: 30 });
  });

  it("finds nothing in an image too narrow to have a horizontal gradient", () => {
    const analysis = analyzeTextRows({ data: new Uint8ClampedArray(10), width: 1, height: 10 });
    expect(analysis.band).toBeNull();
  });

  it("crops to the band plus margin when no horizontal line is near", () => {
    const analysis = analyzeTextRows(image(40, 60, { lines: [{ top: 20, bottom: 40, ink: 0 }] }));
    expect(analysis.crop).toEqual(withMargin({ top: 20, bottom: 40 }, 60));
  });

  it("keeps the crop inside horizontal borders just above and below the text", () => {
    const analysis = analyzeTextRows(
      image(40, 60, {
        lines: [{ top: 20, bottom: 40, ink: 100 }],
        borders: [
          { row: 18, ink: 0 },
          { row: 41, ink: 0 },
        ],
      }),
    );
    expect(analysis.band).toEqual({ top: 20, bottom: 40 });
    // Border rows 18 and 41 lie within the margin; the crop stops before them.
    expect(analysis.crop).toEqual({ top: 19, bottom: 41 });
  });
});

describe("withMargin", () => {
  it("grows the band by the margin fraction of its height on each side", () => {
    const margin = Math.round(TEXT_BAND_MARGIN_FRACTION * 20);
    expect(withMargin({ top: 40, bottom: 60 }, 100)).toEqual({ top: 40 - margin, bottom: 60 + margin });
  });

  it("clamps to the area's edges", () => {
    expect(withMargin({ top: 0, bottom: 100 }, 100)).toEqual({ top: 0, bottom: 100 });
  });
});

/** A 200 x 30 white image with text rows [10, 20): each glyph is a block of
 * 1px vertical bars of `ink` (default black) covering the columns
 * `[left, right)`. */
function glyphs(blocks: readonly { left: number; right: number; ink?: number }[]): GrayscalePixels {
  const width = 200;
  const data = new Uint8ClampedArray(width * 30).fill(255);
  for (const { left, right, ink = 0 } of blocks) {
    for (let y = 10; y < 20; y++) {
      for (let x = left; x < right; x += 2) {
        data[y * width + x] = ink;
      }
    }
  }
  return { data, width, height: 30 };
}

describe("analyzeTextColumns", () => {
  const band = { top: 10, bottom: 20 };
  const margin = Math.round(TEXT_COLUMN_MARGIN_TEXT_HEIGHTS * 10);

  it("spans all glyphs of a line, including word gaps, plus the margin", () => {
    // Glyph gaps of 4px and a word gap of 12px (1.2 text heights).
    const analysis = analyzeTextColumns(
      glyphs([
        { left: 40, right: 48 },
        { left: 52, right: 60 },
        { left: 72, right: 80 },
      ]),
      band,
      DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
    );
    // Profile column 39 holds the transition into the first bar at pixel 40.
    expect(analysis.crop).toEqual({ left: 39 - margin, right: 80 + margin });
  });

  it("leaves out a feature further away than the maximum gap", () => {
    const analysis = analyzeTextColumns(
      glyphs([
        { left: 4, right: 8, ink: 120 },
        { left: 60, right: 90 },
      ]),
      band,
      DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
    );
    expect(analysis.crop).toEqual({ left: 59 - margin, right: 90 + margin });
  });

  it("leaves out a nearby feature when the region's maximum gap is tighter", () => {
    // Gap of 8px = 0.8 text heights: within the default, beyond a single-word 0.5.
    const blocks = [
      { left: 42, right: 46, ink: 120 },
      { left: 54, right: 90 },
    ];
    expect(analyzeTextColumns(glyphs(blocks), band, DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS).crop?.left).toBe(
      41 - margin,
    );
    expect(analyzeTextColumns(glyphs(blocks), band, 0.5).crop?.left).toBe(53 - margin);
  });

  it("picks the text over a stronger but narrow feature far away (e.g. the card's edge)", () => {
    const analysis = analyzeTextColumns(
      glyphs([
        { left: 20, right: 100, ink: 150 },
        { left: 180, right: 184 },
      ]),
      band,
      DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
    );
    expect(analysis.crop).toEqual({ left: 19 - margin, right: 100 + margin });
  });

  it("clamps the margin to the image", () => {
    const analysis = analyzeTextColumns(glyphs([{ left: 0, right: 200 }]), band, DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS);
    expect(analysis.crop).toEqual({ left: 0, right: 200 });
  });

  it("finds no columns when the rows are blank", () => {
    expect(analyzeTextColumns(glyphs([]), band, DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS).crop).toBeNull();
  });
});
