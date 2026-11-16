import type { DetectionStatEvent, DetectionStats, Histogram, OutcomeHistograms, ScanOutcome } from "./detectionStats";
import {
  applyDetectionStatEvents,
  emptyDetectionStats,
  parseDetectionStats,
  readStoredDetectionStats,
  saveDetectionStats,
} from "./detectionStats";

const SPLIT_METRICS = new Set<keyof DetectionStats>([
  "burstFrameChosen",
  "spikeCount",
  "rowConfidenceRatio",
  "centerGrowthMerges",
  "ocrConfidence",
]);

const METRIC_LABELS: Record<keyof DetectionStats, string> = {
  outcomes: "Scan outcome",
  burstFrameChosen: "Burst frame chosen",
  spikeCount: "Collector number spike count",
  rowConfidenceRatio: "Row peak-to-background ratio",
  centerGrowthMerges: "Center-growth merges beyond seed",
  ocrConfidence: "OCR confidence (%, nearest 10)",
  ocrVsAcceptedDistance: "OCR vs. accepted edit distance",
};

/** One series color per outcome, reused for every chart — see :root's
 * --stat-* custom properties in index.html. */
const OUTCOME_COLOR: Record<ScanOutcome, string> = {
  captured: "var(--stat-good)",
  "rescan-number-not-confident": "var(--stat-warning)",
  "rescan-set-unreadable": "var(--stat-critical)",
};
const OUTCOME_LABEL: Record<ScanOutcome, string> = {
  captured: "captured",
  "rescan-number-not-confident": "rescan — number not confident",
  "rescan-set-unreadable": "rescan — set unreadable",
};
const OUTCOME_ORDER: readonly ScanOutcome[] = ["captured", "rescan-number-not-confident", "rescan-set-unreadable"];

/** One bucket's bar: its label, segments (outcome + count, in legend order,
 * zero-count outcomes omitted) and their total. */
interface BarRow {
  label: string;
  segments: { outcome: ScanOutcome; count: number }[];
  total: number;
}

export interface TelemetryPanelElements {
  /** The "Debug mode" checkbox — shown/hidden and recorded to together with it. */
  checkbox: HTMLInputElement;
  /** The panel's own container, hidden outside debug mode. */
  panel: HTMLElement;
  /** Where the charts are rendered. */
  stats: HTMLElement;
  resetButton: HTMLButtonElement;
}

/** Debug-only detection-pipeline telemetry: counts persisted across reloads
 * (see detectionStats.ts), recorded only while debug mode is on, shown as a
 * set of small bar charts in Settings alongside it — one outcome-colored bar
 * per bucket, its length the bucket's share of its metric's busiest one, so
 * both composition and sample size read at a glance. */
export class TelemetryPanel {
  private current: DetectionStats;

  constructor(private readonly elements: TelemetryPanelElements) {
    this.current = loadDetectionStats();
    elements.checkbox.addEventListener("change", () => {
      elements.panel.hidden = !this.enabled;
    });
    elements.resetButton.addEventListener("click", () => this.reset());
    elements.panel.hidden = !this.enabled;
    this.render();
  }

  private get enabled(): boolean {
    return this.elements.checkbox.checked;
  }

  /** Folds every event of `events` into the stats in one save and one
   * render, only while debug mode is on. */
  record(events: readonly DetectionStatEvent[]): void {
    if (!this.enabled || events.length === 0) {
      return;
    }
    this.current = applyDetectionStatEvents(this.current, events);
    saveDetectionStats(this.current);
    this.render();
  }

  private reset(): void {
    this.current = emptyDetectionStats();
    saveDetectionStats(this.current);
    this.render();
  }

  private render(): void {
    const metrics = (Object.keys(METRIC_LABELS) as (keyof DetectionStats)[]).map((metric) => this.metricSection(metric));
    const empty = metrics.every((section) => section.querySelector(".telemetry-bar-row") === null);
    this.elements.stats.replaceChildren(...(empty ? [emptyNote()] : [legend(), ...metrics]));
  }

  private metricSection(metric: keyof DetectionStats): HTMLElement {
    const rows = this.rowsFor(metric);
    const maxTotal = Math.max(1, ...rows.map((row) => row.total));

    const title = document.createElement("h3");
    title.className = "telemetry-metric-title";
    title.textContent = METRIC_LABELS[metric];
    const section = document.createElement("section");
    section.className = "telemetry-metric";
    section.append(title, ...rows.map((row) => barRow(row, maxTotal)));
    return section;
  }

  private rowsFor(metric: keyof DetectionStats): BarRow[] {
    if (metric === "outcomes") {
      return OUTCOME_ORDER.filter((outcome) => this.current.outcomes[outcome]).map((outcome) => ({
        label: OUTCOME_LABEL[outcome],
        segments: [{ outcome, count: this.current.outcomes[outcome]! }],
        total: this.current.outcomes[outcome]!,
      }));
    }
    if (!SPLIT_METRICS.has(metric)) {
      // Only ever recorded on acceptance — all "captured" by definition.
      return histogramBuckets(this.current[metric] as Histogram).map(({ bucket, count }) => ({
        label: bucket,
        segments: [{ outcome: "captured", count }],
        total: count,
      }));
    }
    const byOutcome = this.current[metric] as OutcomeHistograms;
    const buckets = new Set<string>();
    for (const outcome of OUTCOME_ORDER) {
      for (const { bucket } of histogramBuckets(byOutcome[outcome])) {
        buckets.add(bucket);
      }
    }
    return [...buckets]
      .sort((a, b) => Number(a) - Number(b))
      .map((bucket) => {
        const segments = OUTCOME_ORDER.filter((outcome) => byOutcome[outcome][bucket]).map((outcome) => ({
          outcome,
          count: byOutcome[outcome][bucket]!,
        }));
        return { label: bucket, segments, total: segments.reduce((sum, s) => sum + s.count, 0) };
      });
  }
}

/** `histogram`'s entries as {bucket, count}, bucket labels sorted
 * numerically (every bucket here is a non-negative integer). */
function histogramBuckets(histogram: Histogram): { bucket: string; count: number }[] {
  return Object.entries(histogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([bucket, count]) => ({ bucket, count }));
}

function legend(): HTMLElement {
  const el = document.createElement("div");
  el.className = "telemetry-legend";
  el.append(
    ...OUTCOME_ORDER.map((outcome) => {
      const dot = document.createElement("span");
      dot.className = "telemetry-dot";
      dot.style.background = OUTCOME_COLOR[outcome];
      const item = document.createElement("span");
      item.className = "telemetry-legend-item";
      item.append(dot, document.createTextNode(OUTCOME_LABEL[outcome]));
      return item;
    }),
  );
  return el;
}

/** One bar: `row`'s bucket label, a track scaled to `row.total / maxTotal`
 * (so an under-sampled bucket visibly has less evidence behind it) made of
 * one segment per outcome present, and the row's total as a direct label. */
function barRow(row: BarRow, maxTotal: number): HTMLElement {
  const label = document.createElement("span");
  label.className = "telemetry-bar-label";
  label.textContent = row.label;
  label.title = row.label;

  const track = document.createElement("div");
  track.className = "telemetry-bar-track";
  track.style.width = `${Math.max(3, (row.total / maxTotal) * 100)}%`;
  track.append(
    ...row.segments.map((segment) => {
      const el = document.createElement("span");
      el.className = "telemetry-bar-segment";
      el.style.background = OUTCOME_COLOR[segment.outcome];
      el.style.width = `${(segment.count / row.total) * 100}%`;
      el.title = `${OUTCOME_LABEL[segment.outcome]}: ${segment.count}`;
      return el;
    }),
  );

  const total = document.createElement("span");
  total.className = "telemetry-bar-total";
  total.textContent = String(row.total);

  const el = document.createElement("div");
  el.className = "telemetry-bar-row";
  el.append(label, track, total);
  return el;
}

function emptyNote(): HTMLElement {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = "No scans recorded yet.";
  return p;
}

/** The saved stats, best-effort: empty when there's nothing saved, storage
 * is unavailable, or the saved JSON no longer matches DetectionStats (e.g.
 * after a shape change) — this is disposable debug telemetry, not data worth
 * failing the app over. */
function loadDetectionStats(): DetectionStats {
  try {
    const json = readStoredDetectionStats();
    return json === null ? emptyDetectionStats() : parseDetectionStats(json);
  } catch {
    return emptyDetectionStats();
  }
}
