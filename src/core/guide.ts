import {
  EDGE_BAND_HALF_THICKNESS_PX,
  EDGE_BAND_LENGTH_OVERHANG_PX,
  EDGE_BAND_REFERENCE_FRAME_SIZE,
  GUIDE_FILL_FRACTION,
  STANDARD_CARD_ASPECT_RATIO,
} from "./constants";
import type { EdgeBand, GuideRect, Orientation, PerEdge, Point, Size } from "./types";

/** Unit direction pointing away from the guide's center for an edge side
 * (e.g. top → -y). Lets `fitEdgeLine` prefer the outward-most segment. */
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
 * The guide rectangle: centered, card-shaped (STANDARD_CARD_ASPECT_RATIO),
 * long side vertical for a portrait camera and horizontal for landscape,
 * as large as fits within GUIDE_FILL_FRACTION of the frame.
 */
export function computeGuideGeometry(camera: Orientation, frameSize: Size): GuideRect {
  const availableWidth = frameSize.width * GUIDE_FILL_FRACTION;
  const availableHeight = frameSize.height * GUIDE_FILL_FRACTION;

  let width: number;
  let height: number;

  if (camera === "portrait") {
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

  return { center, width, height };
}

/** Linear scale of `frameSize` relative to EDGE_BAND_REFERENCE_FRAME_SIZE,
 * from the area ratio so it holds for any aspect ratio. */
function edgeBandScaleFactor(frameSize: Size): number {
  const referenceArea = EDGE_BAND_REFERENCE_FRAME_SIZE.width * EDGE_BAND_REFERENCE_FRAME_SIZE.height;
  const frameArea = frameSize.width * frameSize.height;
  return Math.sqrt(frameArea / referenceArea);
}

/**
 * The 4 search bands ([top, right, bottom, left]) around the guide's edges.
 * Each is centered on its edge line, EDGE_BAND_HALF_THICKNESS_PX thick on
 * each side, and extends EDGE_BAND_LENGTH_OVERHANG_PX past each end — both
 * scaled from the reference frame size to `frameSize`, which must be the
 * frame `guide` was computed for.
 */
export function expectedEdgeBands(guide: GuideRect, frameSize: Size): PerEdge<EdgeBand> {
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
