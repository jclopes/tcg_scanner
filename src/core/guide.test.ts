import { describe, expect, it } from "vitest";
import {
  EDGE_BAND_HALF_THICKNESS_PX,
  EDGE_BAND_LENGTH_OVERHANG_PX,
  EDGE_BAND_REFERENCE_FRAME_SIZE,
  GUIDE_FILL_FRACTION,
  STANDARD_CARD_ASPECT_RATIO,
} from "./constants";
import { computeGuideGeometry, expectedEdgeBands } from "./guide";
import type { GuideRect } from "./types";

describe("computeGuideGeometry", () => {
  it("is card-shaped, long side vertical for a portrait camera and horizontal for landscape, on any frame shape", () => {
    for (const frame of [
      { width: 1920, height: 1080 },
      { width: 480, height: 1280 },
      { width: 1000, height: 1000 },
    ]) {
      const portrait = computeGuideGeometry("portrait", frame);
      expect(portrait.width / portrait.height).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 6);

      const landscape = computeGuideGeometry("landscape", frame);
      expect(landscape.height / landscape.width).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 6);
    }
  });

  it("fills GUIDE_FILL_FRACTION of the frame's height when height is the binding constraint", () => {
    const guide = computeGuideGeometry("portrait", { width: 1000, height: 1000 });
    expect(guide.height).toBeCloseTo(1000 * GUIDE_FILL_FRACTION, 6);
  });

  it("is limited by the width instead on a frame too narrow for that height", () => {
    const guide = computeGuideGeometry("portrait", { width: 400, height: 2000 });
    expect(guide.width).toBeCloseTo(400 * GUIDE_FILL_FRACTION, 6);
    expect(guide.height).toBeLessThan(2000 * GUIDE_FILL_FRACTION);
  });
});

/** The guide's edge lines. */
function guideEdges(guide: GuideRect): { top: number; right: number; bottom: number; left: number } {
  return {
    top: guide.center.y - guide.height / 2,
    right: guide.center.x + guide.width / 2,
    bottom: guide.center.y + guide.height / 2,
    left: guide.center.x - guide.width / 2,
  };
}

describe("expectedEdgeBands", () => {
  describe("at the reference frame size", () => {
    const frameSize = EDGE_BAND_REFERENCE_FRAME_SIZE;
    const guide = computeGuideGeometry("portrait", frameSize);
    const [top, right, bottom, left] = expectedEdgeBands(guide, frameSize);
    const edges = guideEdges(guide);

    it("centers each band on its guide edge, EDGE_BAND_HALF_THICKNESS_PX on each side", () => {
      const half = EDGE_BAND_HALF_THICKNESS_PX;
      expect(top.region.origin.y).toBeCloseTo(edges.top - half, 6);
      expect(top.region.size.height).toBeCloseTo(2 * half, 6);
      expect(bottom.region.origin.y).toBeCloseTo(edges.bottom - half, 6);
      expect(bottom.region.size.height).toBeCloseTo(2 * half, 6);
      expect(left.region.origin.x).toBeCloseTo(edges.left - half, 6);
      expect(left.region.size.width).toBeCloseTo(2 * half, 6);
      expect(right.region.origin.x).toBeCloseTo(edges.right - half, 6);
      expect(right.region.size.width).toBeCloseTo(2 * half, 6);
    });

    it("extends each band EDGE_BAND_LENGTH_OVERHANG_PX past both ends of its edge", () => {
      const overhang = EDGE_BAND_LENGTH_OVERHANG_PX;
      expect(top.region.origin.x).toBeCloseTo(edges.left - overhang, 6);
      expect(top.region.size.width).toBeCloseTo(guide.width + 2 * overhang, 6);
      expect(left.region.origin.y).toBeCloseTo(edges.top - overhang, 6);
      expect(left.region.size.height).toBeCloseTo(guide.height + 2 * overhang, 6);
    });
  });

  it("scales thickness and overhang linearly with the frame's resolution", () => {
    const bandAt = (scale: number) => {
      const frameSize = {
        width: EDGE_BAND_REFERENCE_FRAME_SIZE.width * scale,
        height: EDGE_BAND_REFERENCE_FRAME_SIZE.height * scale,
      };
      const guide = computeGuideGeometry("portrait", frameSize);
      const [top] = expectedEdgeBands(guide, frameSize);
      return { thickness: top.region.size.height, overhang: (top.region.size.width - guide.width) / 2 };
    };
    const reference = bandAt(1);

    for (const scale of [0.5, 2]) {
      expect(bandAt(scale).thickness).toBeCloseTo(reference.thickness * scale, 6);
      expect(bandAt(scale).overhang).toBeCloseTo(reference.overhang * scale, 6);
    }
  });
});
