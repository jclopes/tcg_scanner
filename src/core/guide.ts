import { EDGE_BAND_CORNER_INSET_FRACTION, GUIDE_FILL_FRACTION, STANDARD_CARD_ASPECT_RATIO } from "./constants";
import type { EdgeBand, GuideRect, Orientation, Point, Size, ToleranceConfig } from "./types";

/**
 * Computes the on-screen guide rectangle for a given camera orientation and
 * frame size.
 *
 * The guide's shape is a pure function of camera orientation only (never of
 * card print format — see plan, "Orientation handling"): portrait camera ->
 * height > width; landscape camera -> width > height. This holds
 * unconditionally regardless of the frame's own aspect ratio, because the
 * guide is always built from the standard card aspect ratio applied to
 * whichever of the frame's two dimensions is unconstrained (see below), never
 * from the frame's shape directly.
 *
 * The guide is centered in the frame and sized to fill as much of it as
 * possible (see GUIDE_FILL_FRACTION) while (a) respecting
 * STANDARD_CARD_ASPECT_RATIO and (b) fitting entirely within the frame.
 */
export function computeGuideGeometry(camera: Orientation, frameSize: Size): GuideRect {
  const availableWidth = frameSize.width * GUIDE_FILL_FRACTION;
  const availableHeight = frameSize.height * GUIDE_FILL_FRACTION;

  let width: number;
  let height: number;

  if (camera === "portrait") {
    // Long side (height) is the constrained dimension; derive width from it.
    // STANDARD_CARD_ASPECT_RATIO < 1, so width < height always holds here.
    height = availableHeight;
    width = height * STANDARD_CARD_ASPECT_RATIO;
    if (width > availableWidth) {
      width = availableWidth;
      height = width / STANDARD_CARD_ASPECT_RATIO;
    }
  } else {
    width = availableWidth;
    height = width * STANDARD_CARD_ASPECT_RATIO;
    if (height > availableHeight) {
      height = availableHeight;
      width = height / STANDARD_CARD_ASPECT_RATIO;
    }
  }

  const center: Point = { x: frameSize.width / 2, y: frameSize.height / 2 };

  return { center, width, height, orientation: camera };
}

/**
 * Computes the 4 expected-edge-location bands for a guide, per the plan's
 * "Search-space reduction" strategy: instead of scanning the whole frame,
 * only these 4 narrow regions (one per guide edge) are searched.
 *
 * Each band is a rectangle:
 * - Its length (along the edge) is the guide's corresponding side length,
 *   inset from both ends by EDGE_BAND_CORNER_INSET_FRACTION to stay clear of
 *   the card's rounded corners.
 * - Its thickness (perpendicular to the edge) accounts for positionTolerance
 *   and zoomTolerance (both expressed as a fraction of the guide's
 *   corresponding dimension) plus the extra perpendicular drift a rotated
 *   edge exhibits at the ends of its (inset) length, given
 *   rotationToleranceDegrees.
 *
 * Returned as a fixed tuple in clockwise order starting at the top:
 * [top, right, bottom, left].
 */
export function expectedEdgeBands(
  guide: GuideRect,
  tolerance: ToleranceConfig,
): [EdgeBand, EdgeBand, EdgeBand, EdgeBand] {
  const halfWidth = guide.width / 2;
  const halfHeight = guide.height / 2;

  const topBottomLength = guide.width * (1 - 2 * EDGE_BAND_CORNER_INSET_FRACTION);
  const leftRightLength = guide.height * (1 - 2 * EDGE_BAND_CORNER_INSET_FRACTION);

  const rotationSlackRad = (tolerance.rotationToleranceDegrees * Math.PI) / 180;
  const combinedFraction = tolerance.positionTolerance + tolerance.zoomTolerance;

  // Half-thickness of the top/bottom bands (their perpendicular axis is
  // vertical) and of the left/right bands (perpendicular axis horizontal).
  const topBottomHalfThickness =
    combinedFraction * guide.height + (topBottomLength / 2) * Math.tan(rotationSlackRad);
  const leftRightHalfThickness =
    combinedFraction * guide.width + (leftRightLength / 2) * Math.tan(rotationSlackRad);

  const top: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - topBottomLength / 2,
        y: guide.center.y - halfHeight - topBottomHalfThickness,
      },
      size: { width: topBottomLength, height: topBottomHalfThickness * 2 },
    },
    side: "top",
  };

  const right: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x + halfWidth - leftRightHalfThickness,
        y: guide.center.y - leftRightLength / 2,
      },
      size: { width: leftRightHalfThickness * 2, height: leftRightLength },
    },
    side: "right",
  };

  const bottom: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - topBottomLength / 2,
        y: guide.center.y + halfHeight - topBottomHalfThickness,
      },
      size: { width: topBottomLength, height: topBottomHalfThickness * 2 },
    },
    side: "bottom",
  };

  const left: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - halfWidth - leftRightHalfThickness,
        y: guide.center.y - leftRightLength / 2,
      },
      size: { width: leftRightHalfThickness * 2, height: leftRightLength },
    },
    side: "left",
  };

  return [top, right, bottom, left];
}
