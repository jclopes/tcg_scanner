import { describe, expect, it } from "vitest";
import { TEXT_BAND_MARGIN_FRACTION } from "./constants";
import { analyzeTextColumns, analyzeTextRows } from "./textBand";
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
  it("finds the rows of a text line, dark-on-light or light-on-dark", () => {
    expect(analyzeTextRows(image(40, 30, { lines: [{ top: 10, bottom: 20, ink: 0 }] })).band).toEqual({ top: 10, bottom: 20 });
    expect(analyzeTextRows(image(40, 30, { lines: [{ top: 5, bottom: 12, ink: 255 }], background: 0 })).band).toEqual({
      top: 5,
      bottom: 12,
    });
  });

  it("finds low-contrast text, since the gate is relative to the background", () => {
    expect(analyzeTextRows(image(40, 30, { lines: [{ top: 10, bottom: 20, ink: 235 }] })).band).toEqual({ top: 10, bottom: 20 });
  });

  it("finds no text in a uniform area, or when every row has the same texture", () => {
    const uniform = analyzeTextRows(image(40, 30, {}));
    expect(uniform.band).toBeNull();
    expect(uniform.crop).toBeNull();
    expect(analyzeTextRows(image(40, 30, { lines: [{ top: 0, bottom: 30, ink: 0 }] })).band).toBeNull();
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

  it("crops to the band plus TEXT_BAND_MARGIN_FRACTION of its height when no horizontal line is near", () => {
    const margin = Math.round(TEXT_BAND_MARGIN_FRACTION * 20);
    const analysis = analyzeTextRows(image(40, 60, { lines: [{ top: 20, bottom: 40, ink: 0 }] }));
    expect(analysis.crop).toEqual({ top: 20 - margin, bottom: 40 + margin });
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

/** A 200 x 30 white image with text rows [10, 20): each block is 1px
 * vertical bars of `ink` (default black) covering the columns
 * `[left, right)` — a weaker (lighter `ink`) block stands in for a glyph OCR
 * finds harder to read, still real text but with less stroke contrast. */
function glyphs(blocks: readonly { left: number; right: number; ink?: number }[]): GrayscalePixels {
  const width = 200;
  const height = 30;
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (const { left, right, ink = 0 } of blocks) {
    for (let y = 10; y < 20; y++) {
      for (let x = left; x < right; x += 2) {
        data[y * width + x] = ink;
      }
    }
  }
  return { data, width, height };
}

describe("analyzeTextColumns", () => {
  const band = { top: 10, bottom: 20 };

  it("crops at the search area's own edges when a glyph has nothing else to stop at", () => {
    // Pure background on both sides all the way out, so there's no nearer
    // dip than the edges themselves to crop at.
    const analysis = analyzeTextColumns(glyphs([{ left: 40, right: 48 }]), band);
    expect(analysis.crop).toEqual({ left: 0, right: 199 });
  });

  it("spans from the first to the last strong character, regardless of the gap between them", () => {
    // No merge-distance limit any more: each side is found independently by
    // scanning in from its own edge, so a wide gap between characters
    // doesn't split them.
    const analysis = analyzeTextColumns(
      glyphs([
        { left: 40, right: 48 },
        { left: 120, right: 128 },
      ]),
      band,
    );
    expect(analysis.mergedRunCount).toBe(1);
    expect(analysis.spikeCount).toBe(2);
  });

  it("doesn't let a climb that never turns over within view (e.g. glare) set the reference strength", () => {
    const image = glyphs([{ left: 90, right: 98 }]);
    // A smooth climb toward the right edge, reaching higher than the real
    // text but never peaking and falling within the search area.
    for (let y = 10; y < 20; y++) {
      for (let x = 150; x < 200; x++) {
        image.data[y * image.width + x] = Math.max(0, 255 - Math.round((x - 150) * 6));
      }
    }
    const analysis = analyzeTextColumns(image, band);
    // Crops right before the climb starts, not at the array's own edge and
    // not fooled into thinking the climb is the real text.
    expect(analysis.crop).toEqual({ left: 0, right: 150 });
  });

  it("still scores a solid-filled glyph's interior, where it has no gradient of its own, by its brightness", () => {
    // A flat-filled block (unlike glyphs()'s alternating bars) has gradient
    // only at its own left/right edges; its interior is otherwise
    // indistinguishable from background by gradient alone.
    const width = 200;
    const data = new Uint8ClampedArray(width * 30).fill(255);
    for (let y = 10; y < 20; y++) {
      for (let x = 50; x < 90; x++) {
        data[y * width + x] = 150;
      }
    }
    const analysis = analyzeTextColumns({ data, width, height: 30 }, band);
    expect(analysis.profile[70]).toBeGreaterThan(0);
  });

  it("finds no columns when the rows are blank", () => {
    expect(analyzeTextColumns(glyphs([]), band).crop).toBeNull();
  });

  it("isn't affected by content just outside the band (e.g. a border just below the text line)", () => {
    const withoutBorder = glyphs([{ left: 40, right: 48 }]);
    const withBorder = glyphs([{ left: 40, right: 48 }]);
    // A strong horizontal feature one row below the band: before cropping to
    // the band first, this leaked into the last band row's vertical
    // gradient and could inflate columns for reasons unrelated to the text.
    for (let x = 0; x < withBorder.width; x++) {
      withBorder.data[band.bottom * withBorder.width + x] = 0;
    }
    expect(analyzeTextColumns(withBorder, band).profile).toEqual(analyzeTextColumns(withoutBorder, band).profile);
  });
});
