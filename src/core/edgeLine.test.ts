import { beforeAll, describe, expect, it } from "vitest";
import { EDGE_MIN_CONFIDENCE } from "./constants";
import { fitEdgeLine } from "./edgeLine";
import { loadOpenCv } from "./testSupport/openCv";
import type { EdgeBandPixels, OpenCv, Point } from "./types";

let cv: OpenCv;

beforeAll(async () => {
  cv = await loadOpenCv();
});

/**
 * Renders a synthetic band image with a hard step edge: pixels on the
 * `direction`-rotated normal's positive side are 255, the other side 0. This
 * gives fitEdgeLine an unambiguous, known ground-truth line (point +
 * direction) to recover.
 */
function renderEdgeBand(width: number, height: number, point: Point, direction: Point): EdgeBandPixels {
  const norm = Math.hypot(direction.x, direction.y);
  const dirX = direction.x / norm;
  const dirY = direction.y / norm;
  // Normal to the direction vector.
  const nx = -dirY;
  const ny = dirX;

  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const signedDistance = (x - point.x) * nx + (y - point.y) * ny;
      data[y * width + x] = signedDistance >= 0 ? 255 : 0;
    }
  }
  return { data, width, height };
}

/** Perpendicular distance from `p` to the infinite line through
 * `linePoint` with (unit) `lineDirection`. */
function perpendicularDistance(p: Point, linePoint: Point, lineDirection: Point): number {
  const nx = -lineDirection.y;
  const ny = lineDirection.x;
  return Math.abs((p.x - linePoint.x) * nx + (p.y - linePoint.y) * ny);
}

/** Absolute angle between two directions, in degrees, treating a direction
 * and its negation as equivalent (a line has no inherent forward). */
function angleBetweenDirectionsDegrees(a: Point, b: Point): number {
  const aNorm = Math.hypot(a.x, a.y);
  const bNorm = Math.hypot(b.x, b.y);
  const dot = (a.x * b.x + a.y * b.y) / (aNorm * bNorm);
  const clamped = Math.max(-1, Math.min(1, Math.abs(dot)));
  return (Math.acos(clamped) * 180) / Math.PI;
}

describe("fitEdgeLine", () => {
  it("fits a vertical edge in a tall, narrow band (left/right-edge-shaped band)", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const trueDirection = { x: 0, y: 1 };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(3);
    expect(perpendicularDistance(result!.point, truePoint, trueDirection)).toBeLessThan(2);
    expect(result!.confidence).toBeGreaterThanOrEqual(EDGE_MIN_CONFIDENCE);
    expect(result!.confidence).toBeLessThanOrEqual(1);
  });

  it("fits a horizontal edge in a short, wide band (top/bottom-edge-shaped band)", () => {
    const width = 160;
    const height = 50;
    const truePoint = { x: 80, y: 25 };
    const trueDirection = { x: 1, y: 0 };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(3);
    expect(perpendicularDistance(result!.point, truePoint, trueDirection)).toBeLessThan(2);
  });

  it("fits a slightly rotated edge (within typical rotation tolerance)", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const angleRad = (8 * Math.PI) / 180;
    const trueDirection = { x: Math.sin(angleRad), y: Math.cos(angleRad) };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(3);
    expect(perpendicularDistance(result!.point, truePoint, trueDirection)).toBeLessThan(3);
  });

  it("still finds the line when part of the edge is occluded (e.g. a finger)", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const trueDirection = { x: 0, y: 1 };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    // Blank out a chunk in the middle third of the band (simulated occlusion),
    // filling it with a mid-gray flat value so it contributes no edge signal.
    const occludedStart = Math.floor(height * 0.4);
    const occludedEnd = Math.floor(height * 0.6);
    for (let y = occludedStart; y < occludedEnd; y++) {
      for (let x = 0; x < width; x++) {
        band.data[y * width + x] = 128;
      }
    }

    const result = fitEdgeLine(cv, band);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(5);
    expect(perpendicularDistance(result!.point, truePoint, trueDirection)).toBeLessThan(3);
  });

  it("returns null for a blank band with no edge (fail-fast)", () => {
    const width = 50;
    const height = 160;
    const data = new Uint8ClampedArray(width * height).fill(128);

    const result = fitEdgeLine(cv, { data, width, height });

    expect(result).toBeNull();
  });

  it("returns null for a low-contrast noisy band with no coherent edge", () => {
    const width = 50;
    const height = 160;
    const data = new Uint8ClampedArray(width * height);
    // Deterministic pseudo-noise, low amplitude, no structure.
    let seed = 42;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = 120 + (seed % 5);
    }

    const result = fitEdgeLine(cv, { data, width, height });

    expect(result).toBeNull();
  });

  it("returns null for malformed input (data length mismatched with dimensions)", () => {
    const result = fitEdgeLine(cv, { data: new Uint8ClampedArray(10), width: 50, height: 160 });
    expect(result).toBeNull();
  });

  it("gives higher confidence to a fully-visible edge than to a mostly-occluded one", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const trueDirection = { x: 0, y: 1 };

    const fullBand = renderEdgeBand(width, height, truePoint, trueDirection);
    const fullResult = fitEdgeLine(cv, fullBand);

    const mostlyOccludedBand = renderEdgeBand(width, height, truePoint, trueDirection);
    // Blank out all but a small sliver at the top of the band.
    for (let y = Math.floor(height * 0.15); y < height; y++) {
      for (let x = 0; x < width; x++) {
        mostlyOccludedBand.data[y * width + x] = 128;
      }
    }
    const occludedResult = fitEdgeLine(cv, mostlyOccludedBand);

    expect(fullResult).not.toBeNull();
    if (occludedResult) {
      expect(occludedResult.confidence).toBeLessThan(fullResult!.confidence);
    }
  });
});
