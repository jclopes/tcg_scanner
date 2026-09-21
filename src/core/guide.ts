import {
  EDGE_BAND_HALF_THICKNESS_PX,
  EDGE_BAND_LENGTH_OVERHANG_PX,
  EDGE_BAND_REFERENCE_FRAME_SIZE,
  GUIDE_FILL_FRACTION,
  STANDARD_CARD_ASPECT_RATIO,
} from "./constants";
import type { EdgeBand, GuideRect, Orientation, Point, Size } from "./types";

/**
 * The unit direction, in a band's own local pixel coordinates, that points
 * away from the guide's center ("outward") for a given edge side — e.g. for
 * the top band, outward is -y (toward the frame's top edge); for bottom,
 * +y; and so on. Lets `fitEdgeLine` prefer segments nearest a band's
 * outward extreme (the card's true physical edge) over ones further inward
 * (e.g. the card's own printed border/artwork frame) without `fitEdgeLine`
 * itself needing to know which side it's fitting — see its doc comment.
 */
export function outwardDirectionForSide(side: EdgeBand["side"]): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

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
 * How much bigger (or smaller) `frameSize` is than
 * EDGE_BAND_REFERENCE_FRAME_SIZE, as a single linear scale factor — e.g. 3
 * for a 3840x2160 frame (exactly 3x the reference's linear dimensions), 1
 * for the reference resolution itself. Derived from the *area* ratio
 * (`sqrt(frameArea / referenceArea)`) rather than comparing one dimension
 * directly, so it stays meaningful even when the camera's aspect ratio
 * isn't the reference's own 16:9 (e.g. a 4:3 request) — width- or
 * height-only would either over- or under-scale depending on which axis
 * happened to change.
 */
function edgeBandScaleFactor(frameSize: Size): number {
  const referenceArea = EDGE_BAND_REFERENCE_FRAME_SIZE.width * EDGE_BAND_REFERENCE_FRAME_SIZE.height;
  const frameArea = frameSize.width * frameSize.height;
  return Math.sqrt(frameArea / referenceArea);
}

/**
 * Computes the 4 expected-edge-location bands for a guide, per the plan's
 * "Search-space reduction" strategy: instead of scanning the whole frame,
 * only these 4 narrow regions (one per guide edge) are searched.
 *
 * Each band is a fixed-pixel-margin rectangle around its guide edge, the
 * same on all 4 sides:
 * - Its thickness (perpendicular to the edge) is
 *   `EDGE_BAND_HALF_THICKNESS_PX * edgeBandScaleFactor(frameSize)` on *each*
 *   side of the edge line — the band is centered on the line, not offset to
 *   one side of it.
 * - Its length (along the edge) is the guide's corresponding side length,
 *   extended by `EDGE_BAND_LENGTH_OVERHANG_PX * edgeBandScaleFactor(frameSize)`
 *   past *each* end — this still legitimately differs between the top/bottom
 *   bands (length derived from guide.width) and the left/right bands (length
 *   derived from guide.height), since a non-square card's own sides really
 *   are different lengths; only the scaled overhang amount is shared.
 *
 * Both margins are pixel counts *at* EDGE_BAND_REFERENCE_FRAME_SIZE, scaled
 * to `frameSize` — not fractions of the guide's size — see
 * EDGE_BAND_HALF_THICKNESS_PX / EDGE_BAND_LENGTH_OVERHANG_PX / and
 * EDGE_BAND_REFERENCE_FRAME_SIZE's doc comments in constants.ts for why.
 * `frameSize` must match the frame `guide` itself was computed against
 * (`computeGuideGeometry`'s own `frameSize` argument) — the two aren't
 * cross-checked here.
 */
export function expectedEdgeBands(guide: GuideRect, frameSize: Size): [EdgeBand, EdgeBand, EdgeBand, EdgeBand] {
  const halfWidth = guide.width / 2;
  const halfHeight = guide.height / 2;

  const scale = edgeBandScaleFactor(frameSize);
  const lengthOverhang = EDGE_BAND_LENGTH_OVERHANG_PX * scale;
  const topBottomLength = guide.width + 2 * lengthOverhang;
  const leftRightLength = guide.height + 2 * lengthOverhang;

  const halfThickness = EDGE_BAND_HALF_THICKNESS_PX * scale;

  const top: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - topBottomLength / 2,
        y: guide.center.y - halfHeight - halfThickness,
      },
      size: { width: topBottomLength, height: halfThickness * 2 },
    },
    side: "top",
  };

  const right: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x + halfWidth - halfThickness,
        y: guide.center.y - leftRightLength / 2,
      },
      size: { width: halfThickness * 2, height: leftRightLength },
    },
    side: "right",
  };

  const bottom: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - topBottomLength / 2,
        y: guide.center.y + halfHeight - halfThickness,
      },
      size: { width: topBottomLength, height: halfThickness * 2 },
    },
    side: "bottom",
  };

  const left: EdgeBand = {
    region: {
      origin: {
        x: guide.center.x - halfWidth - halfThickness,
        y: guide.center.y - leftRightLength / 2,
      },
      size: { width: halfThickness * 2, height: leftRightLength },
    },
    side: "left",
  };

  return [top, right, bottom, left];
}
