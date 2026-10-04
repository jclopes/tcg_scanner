import {
  STANDARD_CARD_ASPECT_RATIO,
  computeGuideGeometry,
  expectedEdgeBands,
  fitEdgeLine,
  isQuadAspectRatioValid,
  mapEdges,
  outwardDirectionForSide,
  quadFromEdgeLines,
} from "../core";
import type { EdgeBandPixels, FittedLine, PerEdge, Point, Quad, Size } from "../core";
import { DEFAULT_TOLERANCE_CONFIG } from "./config";
import type { FrameSampler } from "./frameSampler";
import { orientationFromSize } from "./orientationWatcher";

/** Why a frame's quad wasn't accepted, in the order they're checked. */
export type QuadRejectionReason = "edge-not-found" | "parallel-edges" | "aspect-ratio-out-of-tolerance";

/** A frame whose quad was accepted: the quad and the pixels of the exact frame
 * it was found in (always warp from these, never a newer video frame). */
export interface AcceptedFrame {
  corners: Quad;
  pixels: ImageData;
}

/** One frame's detection result. `bands`/`lines` are always included for the
 * debug views; lines are band-local and `null` where no edge was found. */
export type FrameEvaluation = {
  bands: PerEdge<EdgeBandPixels>;
  lines: PerEdge<FittedLine | null>;
  /** Per edge: was a line found. */
  edgesFound: PerEdge<boolean>;
} & ({ status: "accepted"; frame: AcceptedFrame } | { status: "rejected"; reason: QuadRejectionReason });

/** An accepted frame's evaluation. */
export type AcceptedEvaluation = Extract<FrameEvaluation, { status: "accepted" }>;

/** One detection pass: fit each guide edge in its band, intersect the lines
 * and check the quad's aspect ratio. `frameSize` must match `source`'s. */
export function evaluateFrameForQuad(sampler: FrameSampler, source: CanvasImageSource, frameSize: Size): FrameEvaluation {
  const guide = computeGuideGeometry(orientationFromSize(frameSize), frameSize);
  const expected = expectedEdgeBands(guide, frameSize);
  const bands = sampler.sampleBands(source, frameSize, expected);
  const lines = mapEdges(bands, (band, i) =>
    fitEdgeLine(band, outwardDirectionForSide(expected[i]!.side), DEFAULT_TOLERANCE_CONFIG.rotationToleranceDegrees),
  );
  const edgesFound = mapEdges(lines, (line) => line !== null);
  const base = { bands, lines, edgesFound };

  const [top, right, bottom, left] = lines;
  if (!top || !right || !bottom || !left) {
    return { ...base, status: "rejected", reason: "edge-not-found" };
  }

  const corners = quadFromEdgeLines([
    toFrameCoordinates(top, bands[0].origin),
    toFrameCoordinates(right, bands[1].origin),
    toFrameCoordinates(bottom, bands[2].origin),
    toFrameCoordinates(left, bands[3].origin),
  ]);
  if (!corners) {
    return { ...base, status: "rejected", reason: "parallel-edges" };
  }
  if (!isQuadAspectRatioValid(corners, STANDARD_CARD_ASPECT_RATIO, DEFAULT_TOLERANCE_CONFIG)) {
    return { ...base, status: "rejected", reason: "aspect-ratio-out-of-tolerance" };
  }

  return { ...base, status: "accepted", frame: { corners, pixels: sampler.snapshotFrame() } };
}

/** Translates a band-local line into frame coordinates using the band's
 * actual (clamped) origin. */
function toFrameCoordinates(line: FittedLine, origin: Point): FittedLine {
  return { ...line, point: { x: line.point.x + origin.x, y: line.point.y + origin.y } };
}
