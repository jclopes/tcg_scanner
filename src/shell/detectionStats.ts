import { requireNumber, requireRecord } from "../core";

/** Bucket label → count. */
export type Histogram = Record<string, number>;

/** How a scan attempt ended — the same three outcomes scanSession.ts already
 * distinguishes. Every per-capture metric below is split by this, so a
 * signal's distribution on captures that got rescanned can be told apart
 * from one on captures that were shown to the user. */
export type ScanOutcome = "captured" | "rescan-set-unreadable" | "rescan-number-not-confident";

const SCAN_OUTCOMES: readonly ScanOutcome[] = ["captured", "rescan-set-unreadable", "rescan-number-not-confident"];

/** A histogram kept separately per ScanOutcome. */
export type OutcomeHistograms = Record<ScanOutcome, Histogram>;

/** The metrics split by outcome (see OutcomeHistograms); the rest are plain
 * Histograms. */
const SPLIT_METRICS = ["burstFrameChosen", "spikeCount", "rowConfidenceRatio", "centerGrowthMerges", "ocrConfidence"] as const;
type SplitMetric = (typeof SPLIT_METRICS)[number];

/** Debug-only counters for tuning the detection pipeline: which signals are
 * actually pulling their weight, and which rarely matter. Reset to empty
 * when the user asks, otherwise accumulated across sessions. */
export interface DetectionStats {
  /** How each scan attempt ended. */
  outcomes: Histogram;
  /** Which burst frame (1st, 2nd, ...) selectFrameToFlatten picked. */
  burstFrameChosen: OutcomeHistograms;
  /** The collector_number crop's spikeCount (see analyzeTextColumns). */
  spikeCount: OutcomeHistograms;
  /** The collector_number row band's peak-to-background ratio, floored to an
   * integer (the pass requires at least TEXT_BAND_MIN_PEAK_TO_BACKGROUND). */
  rowConfidenceRatio: OutcomeHistograms;
  /** How many extra runs runsAroundCenter merged beyond its seed run. */
  centerGrowthMerges: OutcomeHistograms;
  /** Tesseract's own 0-100 confidence in the collector-number reading,
   * bucketed to the nearest 10. */
  ocrConfidence: OutcomeHistograms;
  /** Edit distance between the OCR'd collector number and the card ID the
   * user actually accepted — only recorded on acceptance, so not split by
   * outcome (it would always be "captured"). */
  ocrVsAcceptedDistance: Histogram;
}

/** One data point to fold into DetectionStats (see applyDetectionStatEvent). */
export type DetectionStatEvent =
  | { metric: "outcomes"; value: ScanOutcome }
  | { metric: SplitMetric; outcome: ScanOutcome; value: number }
  | { metric: "ocrVsAcceptedDistance"; value: number };

function emptyOutcomeHistograms(): OutcomeHistograms {
  return { captured: {}, "rescan-set-unreadable": {}, "rescan-number-not-confident": {} };
}

export function emptyDetectionStats(): DetectionStats {
  return {
    outcomes: {},
    burstFrameChosen: emptyOutcomeHistograms(),
    spikeCount: emptyOutcomeHistograms(),
    rowConfidenceRatio: emptyOutcomeHistograms(),
    centerGrowthMerges: emptyOutcomeHistograms(),
    ocrConfidence: emptyOutcomeHistograms(),
    ocrVsAcceptedDistance: {},
  };
}

/** `stats` with every event in `events` folded in, as one new object —
 * prefer this over repeated single applyDetectionStatEvent calls to save and
 * render once per batch instead of once per event. */
export function applyDetectionStatEvents(stats: DetectionStats, events: readonly DetectionStatEvent[]): DetectionStats {
  return events.reduce(applyDetectionStatEvent, stats);
}

/** `stats` with `event` folded in, as a new object. A numeric value is
 * floored to a whole-number bucket label. */
export function applyDetectionStatEvent(stats: DetectionStats, event: DetectionStatEvent): DetectionStats {
  if (event.metric === "outcomes") {
    return { ...stats, outcomes: increment(stats.outcomes, event.value) };
  }
  if (event.metric === "ocrVsAcceptedDistance") {
    return { ...stats, ocrVsAcceptedDistance: increment(stats.ocrVsAcceptedDistance, bucketOf(event.value)) };
  }
  const histograms = stats[event.metric];
  return {
    ...stats,
    [event.metric]: { ...histograms, [event.outcome]: increment(histograms[event.outcome], bucketOf(event.value)) },
  };
}

function bucketOf(value: number): string {
  return String(Math.floor(value));
}

function increment(histogram: Histogram, key: string): Histogram {
  return { ...histogram, [key]: (histogram[key] ?? 0) + 1 };
}

const STORAGE_KEY = "tcg-scanner:detection-stats";

/** The saved stats' JSON, or null when nothing is saved. Throws when the
 * browser's storage is unavailable. */
export function readStoredDetectionStats(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/** Throws when the browser's storage is unavailable or full. */
export function saveDetectionStats(stats: DetectionStats): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

const FLAT_METRICS = ["outcomes", "ocrVsAcceptedDistance"] as const;

/** The saved JSON stats. Throws, naming the field, if it isn't a valid
 * DetectionStats. */
export function parseDetectionStats(json: string): DetectionStats {
  const context = `The saved detection stats (localStorage "${STORAGE_KEY}")`;
  const record = requireRecord(JSON.parse(json), context);
  const stats = {} as DetectionStats;
  for (const metric of FLAT_METRICS) {
    stats[metric] = requireHistogram(record, metric, context);
  }
  for (const metric of SPLIT_METRICS) {
    stats[metric] = requireOutcomeHistograms(record, metric, context);
  }
  return stats;
}

function requireHistogram(record: Record<string, unknown>, key: string, context: string): Histogram {
  const histogram = requireRecord(requireFieldObject(record, key, context), `${context}, "${key}"`);
  const result: Histogram = {};
  for (const bucket of Object.keys(histogram)) {
    result[bucket] = requireNumber(histogram, bucket, `${context}, "${key}"`);
  }
  return result;
}

function requireOutcomeHistograms(record: Record<string, unknown>, key: string, context: string): OutcomeHistograms {
  const byOutcome = requireRecord(requireFieldObject(record, key, context), `${context}, "${key}"`);
  const result = {} as OutcomeHistograms;
  for (const outcome of SCAN_OUTCOMES) {
    result[outcome] = requireHistogram(byOutcome, outcome, `${context}, "${key}"`);
  }
  return result;
}

function requireFieldObject(record: Record<string, unknown>, key: string, context: string): unknown {
  const value = record[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}: "${key}" must be an object, got ${JSON.stringify(value)}.`);
  }
  return value;
}
