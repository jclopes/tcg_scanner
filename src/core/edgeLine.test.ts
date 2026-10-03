import { describe, expect, it } from "vitest";
import { EDGE_MIN_CONFIDENCE } from "./constants";
import { fitEdgeLine } from "./edgeLine";
import type { EdgeBandPixels, Point } from "./types";

const TALL = { width: 50, height: 160 }; // a left/right-edge band
const WIDE = { width: 160, height: 50 }; // a top/bottom-edge band
const OUTWARD_RIGHT: Point = { x: 1, y: 0 };
const OUTWARD_TOP: Point = { x: 0, y: -1 };
/** Loose enough for the rotated-edge test plus Hough's 1° angular steps. */
const TOLERANCE_DEGREES = 15;

/** A band with a hard step edge along the line through `point` with
 * `direction`: 255 on one side, 0 on the other. */
function edgeBand(size: { width: number; height: number }, point: Point, direction: Point): EdgeBandPixels {
  const norm = Math.hypot(direction.x, direction.y);
  const nx = -direction.y / norm;
  const ny = direction.x / norm;
  const data = new Uint8ClampedArray(size.width * size.height);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      data[y * size.width + x] = (x - point.x) * nx + (y - point.y) * ny >= 0 ? 255 : 0;
    }
  }
  return { data, ...size, origin: { x: 0, y: 0 } };
}

/** Fills rows `[from, to)` with flat gray: an occluded stretch with no edge. */
function occludeRows(band: EdgeBandPixels, from: number, to: number): EdgeBandPixels {
  band.data.fill(128, from * band.width, to * band.width);
  return band;
}

/** Angle between two line directions in degrees (a direction and its
 * negation are the same line). */
function angleBetweenDirectionsDegrees(a: Point, b: Point): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

function distanceToLine(p: Point, linePoint: Point, direction: Point): number {
  const norm = Math.hypot(direction.x, direction.y);
  return Math.abs((p.x - linePoint.x) * -direction.y + (p.y - linePoint.y) * direction.x) / norm;
}

function expectFitsLine(result: ReturnType<typeof fitEdgeLine>, point: Point, direction: Point, maxDistance = 2): void {
  expect(result).not.toBeNull();
  expect(angleBetweenDirectionsDegrees(result!.direction, direction)).toBeLessThan(3);
  expect(distanceToLine(result!.point, point, direction)).toBeLessThan(maxDistance);
}

describe("fitEdgeLine", () => {
  it("fits a vertical edge in a left/right band and a horizontal edge in a top/bottom band", () => {
    const vertical = { point: { x: 25, y: 80 }, direction: { x: 0, y: 1 } };
    const verticalResult = fitEdgeLine(edgeBand(TALL, vertical.point, vertical.direction), OUTWARD_RIGHT, TOLERANCE_DEGREES);
    expectFitsLine(verticalResult, vertical.point, vertical.direction);
    expect(verticalResult!.confidence).toBeGreaterThanOrEqual(EDGE_MIN_CONFIDENCE);

    const horizontal = { point: { x: 80, y: 25 }, direction: { x: 1, y: 0 } };
    const horizontalResult = fitEdgeLine(edgeBand(WIDE, horizontal.point, horizontal.direction), OUTWARD_TOP, TOLERANCE_DEGREES);
    expectFitsLine(horizontalResult, horizontal.point, horizontal.direction);
  });

  it("fits an edge rotated within the tolerance", () => {
    const angle = (8 * Math.PI) / 180;
    const point = { x: 25, y: 80 };
    const direction = { x: Math.sin(angle), y: Math.cos(angle) };
    expectFitsLine(fitEdgeLine(edgeBand(TALL, point, direction), OUTWARD_RIGHT, TOLERANCE_DEGREES), point, direction, 3);
  });

  it("rejects an edge rotated beyond the tolerance, and finds it once the tolerance covers it", () => {
    const angle = (45 * Math.PI) / 180;
    const point = { x: 25, y: 80 };
    const direction = { x: Math.sin(angle), y: Math.cos(angle) };
    expect(fitEdgeLine(edgeBand(TALL, point, direction), OUTWARD_RIGHT, 8)).toBeNull();
    expectFitsLine(fitEdgeLine(edgeBand(TALL, point, direction), OUTWARD_RIGHT, 50), point, direction);
  });

  it("still finds an edge partly hidden (e.g. by a finger)", () => {
    const point = { x: 25, y: 80 };
    const direction = { x: 0, y: 1 };
    const band = occludeRows(edgeBand(TALL, point, direction), 64, 96);
    expectFitsLine(fitEdgeLine(band, OUTWARD_RIGHT, TOLERANCE_DEGREES), point, direction, 3);
  });

  it("scales confidence with how much of the edge is visible, and finds nothing below EDGE_MIN_CONFIDENCE", () => {
    const point = { x: 25, y: 80 };
    const direction = { x: 0, y: 1 };
    const full = fitEdgeLine(edgeBand(TALL, point, direction), OUTWARD_RIGHT, TOLERANCE_DEGREES);
    const half = fitEdgeLine(occludeRows(edgeBand(TALL, point, direction), 80, 160), OUTWARD_RIGHT, TOLERANCE_DEGREES);
    const sliver = fitEdgeLine(occludeRows(edgeBand(TALL, point, direction), 24, 160), OUTWARD_RIGHT, TOLERANCE_DEGREES);

    expect(half!.confidence).toBeLessThan(full!.confidence);
    expect(half!.confidence).toBeGreaterThanOrEqual(EDGE_MIN_CONFIDENCE);
    expect(sliver).toBeNull(); // only 15% of the edge is visible
  });

  it("prefers the outward-most edge over a stronger inner feature (e.g. the card's printed border)", () => {
    // Left-edge band: background (x < 10), card body, then an inner border (x >= 35).
    const data = new Uint8ClampedArray(TALL.width * TALL.height);
    for (let y = 0; y < TALL.height; y++) {
      for (let x = 0; x < TALL.width; x++) {
        data[y * TALL.width + x] = x < 10 ? 0 : x < 35 ? 128 : 255;
      }
    }
    const result = fitEdgeLine({ data, ...TALL, origin: { x: 0, y: 0 } }, { x: -1, y: 0 }, TOLERANCE_DEGREES);

    expect(result).not.toBeNull();
    expect(Math.abs(result!.point.x - 10)).toBeLessThan(3);
  });

  it("finds no edge in a flat or low-contrast noisy band", () => {
    const flat = new Uint8ClampedArray(TALL.width * TALL.height).fill(128);
    const noise = new Uint8ClampedArray(TALL.width * TALL.height);
    let seed = 42;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = 120 + (seed % 5);
    }
    for (const data of [flat, noise]) {
      expect(fitEdgeLine({ data, ...TALL, origin: { x: 0, y: 0 } }, OUTWARD_RIGHT, TOLERANCE_DEGREES)).toBeNull();
    }
  });
});
