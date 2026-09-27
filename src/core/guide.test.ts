import { describe, expect, it } from "vitest";
import {
  EDGE_BAND_HALF_THICKNESS_PX,
  EDGE_BAND_LENGTH_OVERHANG_PX,
  EDGE_BAND_REFERENCE_FRAME_SIZE,
  GUIDE_FILL_FRACTION,
  STANDARD_CARD_ASPECT_RATIO,
} from "./constants";
import { computeGuideGeometry, expectedEdgeBands } from "./guide";

describe("computeGuideGeometry", () => {
  it("produces a taller-than-wide guide for a portrait camera, regardless of frame shape", () => {
    const wideFrame = computeGuideGeometry("portrait", { width: 1920, height: 1080 });
    const tallFrame = computeGuideGeometry("portrait", { width: 480, height: 1280 });
    const squareFrame = computeGuideGeometry("portrait", { width: 1000, height: 1000 });

    for (const guide of [wideFrame, tallFrame, squareFrame]) {
      expect(guide.height).toBeGreaterThan(guide.width);
    }
  });

  it("produces a wider-than-tall guide for a landscape camera, regardless of frame shape", () => {
    const wideFrame = computeGuideGeometry("landscape", { width: 1920, height: 1080 });
    const tallFrame = computeGuideGeometry("landscape", { width: 480, height: 1280 });
    const squareFrame = computeGuideGeometry("landscape", { width: 1000, height: 1000 });

    for (const guide of [wideFrame, tallFrame, squareFrame]) {
      expect(guide.width).toBeGreaterThan(guide.height);
    }
  });

  it("matches the standard card aspect ratio", () => {
    const portraitGuide = computeGuideGeometry("portrait", { width: 1080, height: 1920 });
    expect(portraitGuide.width / portraitGuide.height).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 6);

    const landscapeGuide = computeGuideGeometry("landscape", { width: 1920, height: 1080 });
    expect(landscapeGuide.height / landscapeGuide.width).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 6);
  });

  it("centers the guide in the frame", () => {
    const frameSize = { width: 1000, height: 800 };
    const guide = computeGuideGeometry("landscape", frameSize);

    expect(guide.center).toEqual({ x: 500, y: 400 });
  });

  it("fits entirely within the frame, filling the constrained dimension per GUIDE_FILL_FRACTION", () => {
    // A square frame is wide enough (width/height = 1 > the card's ~0.716
    // aspect ratio) that height, not width, ends up as the binding
    // constraint for a portrait guide: it should hit the fill fraction
    // exactly, with width derived from it.
    const frameSize = { width: 1000, height: 1000 };
    const guide = computeGuideGeometry("portrait", frameSize);

    expect(guide.width).toBeLessThanOrEqual(frameSize.width);
    expect(guide.height).toBeLessThanOrEqual(frameSize.height);
    expect(guide.height).toBeCloseTo(frameSize.height * GUIDE_FILL_FRACTION, 6);
  });

  it("falls back to constraining by the other dimension on an extreme frame shape", () => {
    // A very wide frame can't fit a tall portrait guide sized off its height
    // without exceeding the available width -- width should be the binding
    // constraint instead.
    const frameSize = { width: 400, height: 2000 };
    const guide = computeGuideGeometry("portrait", frameSize);

    expect(guide.width).toBeLessThanOrEqual(frameSize.width * GUIDE_FILL_FRACTION + 1e-6);
    expect(guide.height).toBeLessThanOrEqual(frameSize.height);
    expect(guide.width / guide.height).toBeCloseTo(STANDARD_CARD_ASPECT_RATIO, 6);
  });
});

describe("expectedEdgeBands", () => {
  // Most of these tests care about *relationships* (ordering, centering,
  // symmetry, equal thickness across sides) that hold regardless of frame
  // resolution, so any frameSize works so long as it's the same one the
  // guide was itself computed against. Frame shape is deliberately not
  // EDGE_BAND_REFERENCE_FRAME_SIZE's own 16:9 for these — proving the
  // relationships hold even off that one specific aspect ratio.
  const frameSize = { width: 1080, height: 1920 };

  it("returns bands in [top, right, bottom, left] order with matching sides", () => {
    const guide = computeGuideGeometry("portrait", frameSize);
    const [top, right, bottom, left] = expectedEdgeBands(guide, frameSize);

    expect(top.side).toBe("top");
    expect(right.side).toBe("right");
    expect(bottom.side).toBe("bottom");
    expect(left.side).toBe("left");
  });

  it("centers each band on its guide edge", () => {
    const guide = computeGuideGeometry("portrait", frameSize);
    const [top, right, bottom, left] = expectedEdgeBands(guide, frameSize);

    const guideTop = guide.center.y - guide.height / 2;
    const guideBottom = guide.center.y + guide.height / 2;
    const guideLeft = guide.center.x - guide.width / 2;
    const guideRight = guide.center.x + guide.width / 2;

    expect(top.region.origin.y + top.region.size.height / 2).toBeCloseTo(guideTop, 6);
    expect(bottom.region.origin.y + bottom.region.size.height / 2).toBeCloseTo(guideBottom, 6);
    expect(left.region.origin.x + left.region.size.width / 2).toBeCloseTo(guideLeft, 6);
    expect(right.region.origin.x + right.region.size.width / 2).toBeCloseTo(guideRight, 6);
  });

  it("keeps opposite bands symmetric around the guide center", () => {
    const landscapeFrameSize = { width: 1920, height: 1080 };
    const guide = computeGuideGeometry("landscape", landscapeFrameSize);
    const [top, right, bottom, left] = expectedEdgeBands(guide, landscapeFrameSize);

    const topMid = top.region.origin.y + top.region.size.height / 2;
    const bottomMid = bottom.region.origin.y + bottom.region.size.height / 2;
    expect(guide.center.y - topMid).toBeCloseTo(bottomMid - guide.center.y, 6);

    const leftMid = left.region.origin.x + left.region.size.width / 2;
    const rightMid = right.region.origin.x + right.region.size.width / 2;
    expect(guide.center.x - leftMid).toBeCloseTo(rightMid - guide.center.x, 6);
  });

  it("gives all 4 bands the same thickness, regardless of the guide's (non-square) aspect ratio", () => {
    const guide = computeGuideGeometry("portrait", frameSize);
    const [top, right, bottom, left] = expectedEdgeBands(guide, frameSize);

    expect(top.region.size.height).toBeCloseTo(right.region.size.width, 6);
    expect(top.region.size.height).toBeCloseTo(bottom.region.size.height, 6);
    expect(top.region.size.height).toBeCloseTo(left.region.size.width, 6);
  });

  // These two check exact pixel values, so they pin frameSize to
  // EDGE_BAND_REFERENCE_FRAME_SIZE itself (scale factor exactly 1) rather
  // than reusing the generic frameSize above.
  describe("at the reference frame resolution", () => {
    const referenceFrameSize = EDGE_BAND_REFERENCE_FRAME_SIZE;

    it("gives every band exactly EDGE_BAND_HALF_THICKNESS_PX on each side of the guide edge line", () => {
      const guide = computeGuideGeometry("portrait", referenceFrameSize);
      const [top, right, bottom, left] = expectedEdgeBands(guide, referenceFrameSize);

      const guideTop = guide.center.y - guide.height / 2;
      const guideBottom = guide.center.y + guide.height / 2;
      const guideLeft = guide.center.x - guide.width / 2;
      const guideRight = guide.center.x + guide.width / 2;

      // Each band's near edge sits EDGE_BAND_HALF_THICKNESS_PX inside the
      // guideline and its far edge sits the same distance outside it — i.e.
      // the guideline itself bisects the band.
      expect(guideTop - top.region.origin.y).toBeCloseTo(EDGE_BAND_HALF_THICKNESS_PX, 6);
      expect(bottom.region.origin.y + bottom.region.size.height - guideBottom).toBeCloseTo(
        EDGE_BAND_HALF_THICKNESS_PX,
        6,
      );
      expect(guideLeft - left.region.origin.x).toBeCloseTo(EDGE_BAND_HALF_THICKNESS_PX, 6);
      expect(right.region.origin.x + right.region.size.width - guideRight).toBeCloseTo(
        EDGE_BAND_HALF_THICKNESS_PX,
        6,
      );

      // Total thickness is the same fixed value on all 4 sides.
      for (const band of [top, right, bottom, left]) {
        const thickness =
          band.side === "top" || band.side === "bottom" ? band.region.size.height : band.region.size.width;
        expect(thickness).toBeCloseTo(EDGE_BAND_HALF_THICKNESS_PX * 2, 6);
      }
    });

    it("overhangs each band's length by exactly EDGE_BAND_LENGTH_OVERHANG_PX past each end of the guide's corners", () => {
      const guide = computeGuideGeometry("portrait", referenceFrameSize);
      const [top, , , left] = expectedEdgeBands(guide, referenceFrameSize);

      expect(top.region.size.width).toBeCloseTo(guide.width + 2 * EDGE_BAND_LENGTH_OVERHANG_PX, 6);
      expect(left.region.size.height).toBeCloseTo(guide.height + 2 * EDGE_BAND_LENGTH_OVERHANG_PX, 6);

      const guideLeft = guide.center.x - guide.width / 2;
      const guideRight = guide.center.x + guide.width / 2;
      expect(guideLeft - top.region.origin.x).toBeCloseTo(EDGE_BAND_LENGTH_OVERHANG_PX, 6);
      expect(top.region.origin.x + top.region.size.width - guideRight).toBeCloseTo(EDGE_BAND_LENGTH_OVERHANG_PX, 6);
    });
  });

  it("scales band thickness and length overhang proportionally with the camera's actual resolution", () => {
    const doubleFrameSize = {
      width: EDGE_BAND_REFERENCE_FRAME_SIZE.width * 2,
      height: EDGE_BAND_REFERENCE_FRAME_SIZE.height * 2,
    };
    const halfFrameSize = {
      width: EDGE_BAND_REFERENCE_FRAME_SIZE.width / 2,
      height: EDGE_BAND_REFERENCE_FRAME_SIZE.height / 2,
    };

    const referenceGuide = computeGuideGeometry("portrait", EDGE_BAND_REFERENCE_FRAME_SIZE);
    const [referenceTop] = expectedEdgeBands(referenceGuide, EDGE_BAND_REFERENCE_FRAME_SIZE);

    const doubleGuide = computeGuideGeometry("portrait", doubleFrameSize);
    const [doubleTop] = expectedEdgeBands(doubleGuide, doubleFrameSize);

    const halfGuide = computeGuideGeometry("portrait", halfFrameSize);
    const [halfTop] = expectedEdgeBands(halfGuide, halfFrameSize);

    // A frame with exactly double the reference's linear dimensions (4x the
    // area) scales the band margins by exactly 2x; half the linear
    // dimensions scales them by exactly 0.5x.
    expect(doubleTop.region.size.height).toBeCloseTo(referenceTop.region.size.height * 2, 6);
    expect(halfTop.region.size.height).toBeCloseTo(referenceTop.region.size.height * 0.5, 6);

    const referenceOverhang = referenceTop.region.size.width - referenceGuide.width;
    const doubleOverhang = doubleTop.region.size.width - doubleGuide.width;
    const halfOverhang = halfTop.region.size.width - halfGuide.width;
    expect(doubleOverhang).toBeCloseTo(referenceOverhang * 2, 6);
    expect(halfOverhang).toBeCloseTo(referenceOverhang * 0.5, 6);
  });
});
