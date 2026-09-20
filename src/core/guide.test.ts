import { describe, expect, it } from "vitest";
import { GUIDE_FILL_FRACTION, STANDARD_CARD_ASPECT_RATIO } from "./constants";
import { computeGuideGeometry, expectedEdgeBands } from "./guide";
import type { ToleranceConfig } from "./types";

const TOLERANCE: ToleranceConfig = {
  positionTolerance: 0.05,
  rotationToleranceDegrees: 5,
  zoomTolerance: 0.05,
  aspectRatioTolerance: 0.08,
};

describe("computeGuideGeometry", () => {
  it("produces a taller-than-wide guide for a portrait camera, regardless of frame shape", () => {
    const wideFrame = computeGuideGeometry("portrait", { width: 1920, height: 1080 });
    const tallFrame = computeGuideGeometry("portrait", { width: 480, height: 1280 });
    const squareFrame = computeGuideGeometry("portrait", { width: 1000, height: 1000 });

    for (const guide of [wideFrame, tallFrame, squareFrame]) {
      expect(guide.orientation).toBe("portrait");
      expect(guide.height).toBeGreaterThan(guide.width);
    }
  });

  it("produces a wider-than-tall guide for a landscape camera, regardless of frame shape", () => {
    const wideFrame = computeGuideGeometry("landscape", { width: 1920, height: 1080 });
    const tallFrame = computeGuideGeometry("landscape", { width: 480, height: 1280 });
    const squareFrame = computeGuideGeometry("landscape", { width: 1000, height: 1000 });

    for (const guide of [wideFrame, tallFrame, squareFrame]) {
      expect(guide.orientation).toBe("landscape");
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
  it("returns bands in [top, right, bottom, left] order with matching sides", () => {
    const guide = computeGuideGeometry("portrait", { width: 1080, height: 1920 });
    const [top, right, bottom, left] = expectedEdgeBands(guide, TOLERANCE);

    expect(top.side).toBe("top");
    expect(right.side).toBe("right");
    expect(bottom.side).toBe("bottom");
    expect(left.side).toBe("left");
  });

  it("centers each band on its guide edge", () => {
    const guide = computeGuideGeometry("portrait", { width: 1080, height: 1920 });
    const [top, right, bottom, left] = expectedEdgeBands(guide, TOLERANCE);

    const guideTop = guide.center.y - guide.height / 2;
    const guideBottom = guide.center.y + guide.height / 2;
    const guideLeft = guide.center.x - guide.width / 2;
    const guideRight = guide.center.x + guide.width / 2;

    expect(top.region.origin.y + top.region.size.height / 2).toBeCloseTo(guideTop, 6);
    expect(bottom.region.origin.y + bottom.region.size.height / 2).toBeCloseTo(guideBottom, 6);
    expect(left.region.origin.x + left.region.size.width / 2).toBeCloseTo(guideLeft, 6);
    expect(right.region.origin.x + right.region.size.width / 2).toBeCloseTo(guideRight, 6);
  });

  it("insets each band's length from the guide's corners", () => {
    const guide = computeGuideGeometry("portrait", { width: 1080, height: 1920 });
    const [top, , , left] = expectedEdgeBands(guide, TOLERANCE);

    expect(top.region.size.width).toBeLessThan(guide.width);
    expect(left.region.size.height).toBeLessThan(guide.height);
  });

  it("widens band thickness as tolerance increases", () => {
    const guide = computeGuideGeometry("portrait", { width: 1080, height: 1920 });
    const tight: ToleranceConfig = { ...TOLERANCE, positionTolerance: 0.01, zoomTolerance: 0.01, rotationToleranceDegrees: 1 };
    const loose: ToleranceConfig = { ...TOLERANCE, positionTolerance: 0.2, zoomTolerance: 0.2, rotationToleranceDegrees: 20 };

    const [tightTop] = expectedEdgeBands(guide, tight);
    const [looseTop] = expectedEdgeBands(guide, loose);

    expect(looseTop.region.size.height).toBeGreaterThan(tightTop.region.size.height);
  });

  it("keeps opposite bands symmetric around the guide center", () => {
    const guide = computeGuideGeometry("landscape", { width: 1920, height: 1080 });
    const [top, right, bottom, left] = expectedEdgeBands(guide, TOLERANCE);

    const topMid = top.region.origin.y + top.region.size.height / 2;
    const bottomMid = bottom.region.origin.y + bottom.region.size.height / 2;
    expect(guide.center.y - topMid).toBeCloseTo(bottomMid - guide.center.y, 6);

    const leftMid = left.region.origin.x + left.region.size.width / 2;
    const rightMid = right.region.origin.x + right.region.size.width / 2;
    expect(guide.center.x - leftMid).toBeCloseTo(rightMid - guide.center.x, 6);
  });
});
