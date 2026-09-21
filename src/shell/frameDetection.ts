import {
  STANDARD_CARD_ASPECT_RATIO,
  computeGuideGeometry,
  expectedEdgeBands,
  intersectLines,
  validateQuad,
} from "../core";
import type { EdgeBandPixels, FittedLine, Point, Size } from "../core";
import type { EdgeDetectionPool } from "../workers";
import { DEFAULT_TOLERANCE_CONFIG } from "./config";
import type { FrameSampler } from "./frameSampler";
import { orientationFromSize } from "./orientationWatcher";

/** Why a frame's quad wasn't accepted — one label per rejection point in
 * `evaluateFrameForQuad`, in the order they're checked. Surfaced by the
 * debug feature (see `RawEdgeDetection.rejectionReason`) so a rejected
 * frame's "why" is visible, not just silently dropped. */
export type QuadRejectionReason = "edge-not-found" | "parallel-edges" | "aspect-ratio-out-of-tolerance";

/** The raw per-edge detection outcome for one evaluated frame — the 4
 * sampled bands and their fitted lines (each possibly `null` if that edge
 * wasn't found), regardless of whether a valid quad resulted. Defensive
 * copies: the pool transfers/detaches the buffers it's given, so these
 * (built *before* that transfer) are safe to keep and reuse afterward. */
export interface RawEdgeDetection {
  bands: [EdgeBandPixels, EdgeBandPixels, EdgeBandPixels, EdgeBandPixels];
  lines: [FittedLine | null, FittedLine | null, FittedLine | null, FittedLine | null];
  /** Why this frame's quad wasn't accepted — `null` if it was. */
  rejectionReason: QuadRejectionReason | null;
}

export interface FrameEvaluation {
  /** Present only when all 4 edges were found and the resulting quad
   * passed `validateQuad`. */
  accepted: {
    /** In `frameCanvas`'s own pixel coordinates — [topLeft, topRight,
     * bottomRight, bottomLeft], per src/core's corner-order convention. */
    corners: [Point, Point, Point, Point];
    /** A snapshot of the exact frame `corners` was computed from — the
     * capture step must warp *this* canvas, not a freshly-grabbed one, so
     * detection and flattening always agree on which frame they're
     * looking at. */
    frameCanvas: HTMLCanvasElement;
  } | null;
  /** Whether each of [top, right, bottom, left]'s `fitEdgeLine` call found
   * an edge — *always* populated (unlike `raw`), since it's just 4
   * booleans derived from data `detectEdges` already returned, not
   * something that needs the sampled bands cloned. Drives the live guide
   * overlay's per-edge color feedback (see app.ts) on every evaluated
   * frame, not just when debug mode is on. */
  edgesFound: [boolean, boolean, boolean, boolean];
  /** Present only when the caller asked for it (`needsRawBands`). */
  raw: RawEdgeDetection | null;
}

/**
 * Runs one full quad-detection pass against a single frame: computes the
 * guide + its 4 edge bands for the frame's own dimensions, samples each
 * band's pixels, fits all 4 edges in parallel via the worker pool, and — if
 * all 4 fit — intersects and validates the resulting quad.
 *
 * Deliberately source-agnostic (`source`/`frameSize` rather than an
 * `HTMLVideoElement`) so it's testable against a plain canvas/bitmap, not
 * just a live video element. `frameSize` must match `source`'s actual pixel
 * dimensions.
 *
 * `needsRawBands` gates cloning the sampled bands before they're
 * transferred to the worker pool — real, per-call cost, so callers that
 * don't need `raw` (the live loop's normal per-frame path, most of the
 * time) skip paying for it.
 */
export async function evaluateFrameForQuad(
  sampler: FrameSampler,
  pool: EdgeDetectionPool,
  source: CanvasImageSource,
  frameSize: Size,
  needsRawBands: boolean,
): Promise<FrameEvaluation> {
  const orientation = orientationFromSize(frameSize);
  const guide = computeGuideGeometry(orientation, frameSize);
  const bands = expectedEdgeBands(guide, frameSize);
  const sampled = sampler.sampleBands(source, frameSize, bands);
  const sampledBands = sampled.bands as [EdgeBandPixels, EdgeBandPixels, EdgeBandPixels, EdgeBandPixels];

  // Cloned *before* detectEdges, which transfers (detaches) each band's
  // underlying buffer to its worker — sampledBands' own buffers are
  // unusable once that call is made.
  const clonedBands = needsRawBands ? (sampledBands.map(cloneEdgeBandPixels) as typeof sampledBands) : null;

  const [topPixels, rightPixels, bottomPixels, leftPixels] = sampledBands;
  const [topLine, rightLine, bottomLine, leftLine] = await pool.detectEdges(
    [topPixels, rightPixels, bottomPixels, leftPixels],
    DEFAULT_TOLERANCE_CONFIG.rotationToleranceDegrees,
  );
  const edgesFound: [boolean, boolean, boolean, boolean] = [!!topLine, !!rightLine, !!bottomLine, !!leftLine];

  function reject(reason: QuadRejectionReason): FrameEvaluation {
    return {
      accepted: null,
      edgesFound,
      raw: clonedBands
        ? {
            bands: clonedBands,
            lines: [topLine, rightLine, bottomLine, leftLine],
            rejectionReason: reason,
          }
        : null,
    };
  }

  // Per src/core's documented contract (QuadValidationResult's doc comment
  // in types.ts), a missing edge is the caller's responsibility to
  // short-circuit on — validateQuad is never called with one.
  if (!topLine || !rightLine || !bottomLine || !leftLine) {
    return reject("edge-not-found");
  }

  // Translate using each band's *actual* (post-clamp) origin — carried on
  // the sampled EdgeBandPixels itself — rather than the EdgeBand.region
  // .origin that was merely requested. extractGrayscaleRegion clamps bands
  // that extend past the frame's bounds (expected for a band near the
  // frame edge; see GUIDE_FILL_FRACTION's doc comment), and using the
  // unclamped origin here silently mistranslates any clamped band's line.
  const top = toFrameCoordinates(topLine, topPixels.origin);
  const right = toFrameCoordinates(rightLine, rightPixels.origin);
  const bottom = toFrameCoordinates(bottomLine, bottomPixels.origin);
  const left = toFrameCoordinates(leftLine, leftPixels.origin);

  let corners: [Point, Point, Point, Point];
  try {
    corners = [
      intersectLines(top, left), // topLeft
      intersectLines(top, right), // topRight
      intersectLines(bottom, right), // bottomRight
      intersectLines(bottom, left), // bottomLeft
    ];
  } catch {
    // intersectLines throws on (near-)parallel adjacent edges — a genuine
    // per-frame detection failure, not a bug. Discard the frame.
    return reject("parallel-edges");
  }

  // No separate quad-level angle plausibility check here: fitEdgeLine now
  // rejects any per-edge segment whose angle deviates from that band's
  // expected direction by more than rotationToleranceDegrees (see its doc
  // comment), so a quad reconstructed from 4 accepted lines already can't
  // be skewed beyond what that same tolerance allows — fixing this at the
  // edge-fitting root made the old aggregate corner-angle check redundant.
  const validation = validateQuad(corners, STANDARD_CARD_ASPECT_RATIO, DEFAULT_TOLERANCE_CONFIG);
  if (!validation.valid || !validation.corners) {
    return reject("aspect-ratio-out-of-tolerance");
  }

  return {
    accepted: { corners: validation.corners, frameCanvas: imageDataToCanvas(sampled.frame) },
    edgesFound,
    raw: clonedBands
      ? { bands: clonedBands, lines: [topLine, rightLine, bottomLine, leftLine], rejectionReason: null }
      : null,
  };
}

function cloneEdgeBandPixels(band: EdgeBandPixels): EdgeBandPixels {
  return { ...band, data: band.data.slice() };
}

/** Builds the accepted-frame snapshot only once a quad has actually
 * validated (not on every evaluated frame) — the one place this pays for a
 * canvas + `putImageData` write. */
function imageDataToCanvas(frame: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context for the accepted frame snapshot.");
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

/** Translates a band-local FittedLine (as fitEdgeLine/the worker pool
 * produce it) into frame coordinates by adding the sampled band's actual
 * origin — per FittedLine's doc comment, required before intersecting lines
 * from two different bands. */
function toFrameCoordinates(line: FittedLine, origin: Point): FittedLine {
  return {
    ...line,
    point: {
      x: line.point.x + origin.x,
      y: line.point.y + origin.y,
    },
  };
}
