import { beforeAll, describe, expect, it } from "vitest";
import { EDGE_MIN_CONFIDENCE } from "./constants";
import { angleBetweenDirectionsDegrees, fitEdgeLine } from "./edgeLine";
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
  return { data, width, height, origin: { x: 0, y: 0 } };
}

/** Perpendicular distance from `p` to the infinite line through
 * `linePoint` with (unit) `lineDirection`. */
function perpendicularDistance(p: Point, linePoint: Point, lineDirection: Point): number {
  const nx = -lineDirection.y;
  const ny = lineDirection.x;
  return Math.abs((p.x - linePoint.x) * nx + (p.y - linePoint.y) * ny);
}

// Used throughout below for bands shaped like a left/right-edge band
// (tall, narrow — thickness axis is x) and a top/bottom-edge band
// (short, wide — thickness axis is y), respectively. The actual value only
// matters for tests that put more than one candidate edge in the band;
// for single-edge tests it's an arbitrary but shape-appropriate choice.
const OUTWARD_RIGHT: Point = { x: 1, y: 0 };
const OUTWARD_TOP: Point = { x: 0, y: -1 };

// A generous rotation tolerance for tests that aren't specifically
// exercising the angle-plausibility filter itself — comfortably covers the
// 8°-rotated-edge test below plus normal Hough angular-resolution noise
// (1°, per EDGE_HOUGH_THETA), without being so wide it'd stop meaning
// anything. Production uses DEFAULT_TOLERANCE_CONFIG.rotationToleranceDegrees
// (8°); this is deliberately looser since these tests aren't about that
// exact value.
const GENEROUS_ROTATION_TOLERANCE_DEGREES = 15;

describe("fitEdgeLine", () => {
  it("fits a vertical edge in a tall, narrow band (left/right-edge-shaped band)", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const trueDirection = { x: 0, y: 1 };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band, OUTWARD_RIGHT, GENEROUS_ROTATION_TOLERANCE_DEGREES);

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
    const result = fitEdgeLine(cv, band, OUTWARD_TOP, GENEROUS_ROTATION_TOLERANCE_DEGREES);

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
    const result = fitEdgeLine(cv, band, OUTWARD_RIGHT, GENEROUS_ROTATION_TOLERANCE_DEGREES);

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

    const result = fitEdgeLine(cv, band, OUTWARD_RIGHT, GENEROUS_ROTATION_TOLERANCE_DEGREES);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(5);
    expect(perpendicularDistance(result!.point, truePoint, trueDirection)).toBeLessThan(3);
  });

  it("prefers the outward-most edge over a further-in feature (e.g. a card's own inner border)", () => {
    const width = 50;
    const height = 160;
    const outerEdgeX = 10;
    const innerEdgeX = 35;

    // Three flat bands separated by two hard vertical edges: "outside" the
    // card (x < 10), the card body (10 <= x < 35), and an inner
    // graphic/border (x >= 35) — simulating a left-edge band where the true
    // physical card edge (outerEdgeX) sits well outside a strong inner
    // feature (innerEdgeX).
    const data = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = x < outerEdgeX ? 0 : x < innerEdgeX ? 128 : 255;
        data[y * width + x] = value;
      }
    }
    const band: EdgeBandPixels = { data, width, height, origin: { x: 0, y: 0 } };

    // Outward is toward smaller x here (this band's outer boundary, like a
    // left-side band whose card interior lies toward larger x).
    const result = fitEdgeLine(cv, band, { x: -1, y: 0 }, GENEROUS_ROTATION_TOLERANCE_DEGREES);

    expect(result).not.toBeNull();
    expect(Math.abs(result!.point.x - outerEdgeX)).toBeLessThan(3);
    expect(Math.abs(result!.point.x - innerEdgeX)).toBeGreaterThan(10);
  });

  it("rejects a strong edge whose angle deviates too far from the expected direction", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    // 45° off vertical — a genuine, strongly-visible edge, but far outside
    // any plausible card-rotation tolerance for this band's expected
    // (vertical, per OUTWARD_RIGHT) direction.
    const angleRad = (45 * Math.PI) / 180;
    const trueDirection = { x: Math.sin(angleRad), y: Math.cos(angleRad) };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band, OUTWARD_RIGHT, 8);

    expect(result).toBeNull();
  });

  it("accepts that same off-angle edge once the tolerance is widened enough to cover it", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const angleRad = (45 * Math.PI) / 180;
    const trueDirection = { x: Math.sin(angleRad), y: Math.cos(angleRad) };

    const band = renderEdgeBand(width, height, truePoint, trueDirection);
    const result = fitEdgeLine(cv, band, OUTWARD_RIGHT, 50);

    expect(result).not.toBeNull();
    expect(angleBetweenDirectionsDegrees(result!.direction, trueDirection)).toBeLessThan(3);
  });

  it("returns null for a blank band with no edge (fail-fast)", () => {
    const width = 50;
    const height = 160;
    const data = new Uint8ClampedArray(width * height).fill(128);

    const result = fitEdgeLine(
      cv,
      { data, width, height, origin: { x: 0, y: 0 } },
      OUTWARD_RIGHT,
      GENEROUS_ROTATION_TOLERANCE_DEGREES,
    );

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

    const result = fitEdgeLine(
      cv,
      { data, width, height, origin: { x: 0, y: 0 } },
      OUTWARD_RIGHT,
      GENEROUS_ROTATION_TOLERANCE_DEGREES,
    );

    expect(result).toBeNull();
  });

  it("throws for malformed input (data length mismatched with dimensions)", () => {
    expect(() =>
      fitEdgeLine(
        cv,
        { data: new Uint8ClampedArray(10), width: 50, height: 160, origin: { x: 0, y: 0 } },
        OUTWARD_RIGHT,
        GENEROUS_ROTATION_TOLERANCE_DEGREES,
      ),
    ).toThrow();
  });

  it("returns null for a band too thin to hold an edge (clamped at the frame boundary)", () => {
    const result = fitEdgeLine(
      cv,
      { data: new Uint8ClampedArray(160), width: 1, height: 160, origin: { x: 0, y: 0 } },
      OUTWARD_RIGHT,
      GENEROUS_ROTATION_TOLERANCE_DEGREES,
    );
    expect(result).toBeNull();
  });

  it("gives higher confidence to a fully-visible edge than to a mostly-occluded one", () => {
    const width = 50;
    const height = 160;
    const truePoint = { x: 25, y: 80 };
    const trueDirection = { x: 0, y: 1 };

    const fullBand = renderEdgeBand(width, height, truePoint, trueDirection);
    const fullResult = fitEdgeLine(cv, fullBand, OUTWARD_RIGHT, GENEROUS_ROTATION_TOLERANCE_DEGREES);

    const mostlyOccludedBand = renderEdgeBand(width, height, truePoint, trueDirection);
    // Blank out all but a small sliver at the top of the band.
    for (let y = Math.floor(height * 0.15); y < height; y++) {
      for (let x = 0; x < width; x++) {
        mostlyOccludedBand.data[y * width + x] = 128;
      }
    }
    const occludedResult = fitEdgeLine(cv, mostlyOccludedBand, OUTWARD_RIGHT, GENEROUS_ROTATION_TOLERANCE_DEGREES);

    expect(fullResult).not.toBeNull();
    if (occludedResult) {
      expect(occludedResult.confidence).toBeLessThan(fullResult!.confidence);
    }
  });
});
