import {
  STANDARD_CARD_ASPECT_RATIO,
  computeGuideGeometry,
  expectedEdgeBands,
  isQuadAspectRatioValid,
  quadFromEdgeLines,
} from "../core";
import type { EdgeBandPixels, FittedLine, Point, Quad, Size } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { DEFAULT_TOLERANCE_CONFIG } from "./config";
import type { FrameSampler } from "./frameSampler";
import { orientationFromSize } from "./orientationWatcher";

/** Why a frame's quad wasn't accepted, in the order they're checked. */
export type QuadRejectionReason = "edge-not-found" | "parallel-edges" | "aspect-ratio-out-of-tolerance";

export type EdgeBands = [EdgeBandPixels, EdgeBandPixels, EdgeBandPixels, EdgeBandPixels];
export type EdgeLines = [FittedLine | null, FittedLine | null, FittedLine | null, FittedLine | null];

/** A frame whose quad was accepted: the quad and the exact frame it was found
 * in (always flatten this canvas, never a newer video frame). */
export interface AcceptedFrame {
  corners: Quad;
  frameCanvas: HTMLCanvasElement;
}

/** One frame's detection result. `bands`/`lines` are always included for the
 * debug views; lines are band-local and `null` where no edge was found. */
export type FrameEvaluation = {
  bands: EdgeBands;
  lines: EdgeLines;
  /** Per edge [top, right, bottom, left]: was a line found. */
  edgesFound: [boolean, boolean, boolean, boolean];
} & ({ status: "accepted"; frame: AcceptedFrame } | { status: "rejected"; reason: QuadRejectionReason });

/**
 * Runs one quad-detection pass on a frame: sample the 4 guide-edge bands, fit
 * each edge in the worker pool, intersect the lines and validate the quad's
 * aspect ratio. `frameSize` must match `source`'s pixel dimensions. An
 * accepted frame's canvas is `sampler`'s snapshot of this frame, so the
 * caller must not sample with `sampler` again until this resolves (each
 * detection loop and burst owns its sampler and awaits every frame).
 */
export async function evaluateFrameForQuad(
  sampler: FrameSampler,
  pool: EdgeDetectionPool,
  source: CanvasImageSource,
  frameSize: Size,
): Promise<FrameEvaluation> {
  const guide = computeGuideGeometry(orientationFromSize(frameSize), frameSize);
  const sampledBands = sampler.sampleBands(source, frameSize, expectedEdgeBands(guide, frameSize)) as EdgeBands;

  // detectEdges transfers (detaches) each band's buffer, so keep a copy.
  const bands = sampledBands.map(cloneEdgeBandPixels) as EdgeBands;
  const lines = await pool.detectEdges(sampledBands, DEFAULT_TOLERANCE_CONFIG.rotationToleranceDegrees);
  const edgesFound = lines.map(Boolean) as [boolean, boolean, boolean, boolean];
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

  return { ...base, status: "accepted", frame: { corners, frameCanvas: sampler.snapshotFrame() } };
}

function cloneEdgeBandPixels(band: EdgeBandPixels): EdgeBandPixels {
  return { ...band, data: band.data.slice() };
}

/** Translates a band-local line into frame coordinates using the band's
 * actual (clamped) origin. */
function toFrameCoordinates(line: FittedLine, origin: Point): FittedLine {
  return { ...line, point: { x: line.point.x + origin.x, y: line.point.y + origin.y } };
}
