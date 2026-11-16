import {
  HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND,
  TEXT_BAND_ENERGY_THRESHOLD_FRACTION,
  TEXT_BAND_MARGIN_FRACTION,
  TEXT_BAND_MIN_PEAK_TO_BACKGROUND,
  TEXT_COLUMN_BACKGROUND_THRESHOLD_FRACTION,
  TEXT_COLUMN_BRIGHTNESS_WEIGHT,
  TEXT_COLUMN_EDGE_MARGIN_TEXT_HEIGHTS,
  TEXT_COLUMN_REFERENCE_PERCENTILE,
  TEXT_COLUMN_SPIKE_FRACTION,
  TEXT_COLUMN_SPIKE_RISE_FRACTION,
  TEXT_RUN_SIGNIFICANCE_FRACTION,
} from "./constants";
import type { GrayscalePixels } from "./types";

/** A horizontal band of rows: `top` inclusive, `bottom` exclusive. */
export interface RowBand {
  top: number;
  bottom: number;
}

/** Everything `analyzeTextRows` measured, including the profiles for the
 * debug plot. */
export interface TextRowAnalysis {
  /** Per row: mean |g[x+1] − g[x]| — glyph strokes (vertical edges). */
  textProfile: number[];
  /** Rows above this belong to the text band (0 when no text was found). */
  textThreshold: number;
  /** Per row y: mean |g[y+1][x] − g[y][x]| — horizontal edges such as borders. */
  lineProfile: number[];
  /** Rows above this count as horizontal lines: stronger than the background
   * (HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND × median) and than any
   * horizontal edge inside the text band (the letters' own tops/bottoms). */
  lineThreshold: number;
  /** The strongest text line's rows, or `null` if the area has no text. */
  band: RowBand | null;
  /** `band` plus margin, kept between the nearest horizontal lines around it;
   * `null` exactly when `band` is. */
  crop: RowBand | null;
  /** The strongest row's energy over the median (background) row's — how far
   * above TEXT_BAND_MIN_PEAK_TO_BACKGROUND the peak reached. 0 when the
   * profile is empty or flat. For telemetry: how much headroom a band (or a
   * near-miss) has over the pass/fail line. */
  peakToBackgroundRatio: number;
}

/** The rows to crop a search area to: the run around the strongest
 * glyph-stroke row (if it stands out from the median by
 * TEXT_BAND_MIN_PEAK_TO_BACKGROUND), plus a margin that stops at strong
 * horizontal lines (e.g. a badge border). A weak peak is still returned here
 * — `analyzeTextColumns`'s `spikeCount` is the real confidence check, since a
 * row peak alone can't tell real text from a single decorative feature. */
export function analyzeTextRows(pixels: GrayscalePixels): TextRowAnalysis {
  const textProfile = rowGradientProfile(pixels);
  const lineProfile = rowEdgeProfile(pixels);
  const backgroundLineThreshold = HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND * median(lineProfile);
  const found = findBand(textProfile);

  if (!found.band) {
    return {
      textProfile,
      textThreshold: 0,
      lineProfile,
      lineThreshold: backgroundLineThreshold,
      band: null,
      crop: null,
      peakToBackgroundRatio: found.peakToBackgroundRatio,
    };
  }

  const lettersEdgeMax = Math.max(0, ...lineProfile.slice(found.band.top, found.band.bottom));
  const lineThreshold = Math.max(backgroundLineThreshold, lettersEdgeMax);
  const bounds = lineBounds(lineProfile, lineThreshold, found.band, pixels.height);
  const margined = withMargin(found.band, pixels.height);
  return {
    textProfile,
    textThreshold: found.threshold,
    lineProfile,
    lineThreshold,
    band: found.band,
    crop: { top: Math.max(margined.top, bounds.top), bottom: Math.min(margined.bottom, bounds.bottom) },
    peakToBackgroundRatio: found.peakToBackgroundRatio,
  };
}

/** A vertical band of columns: `left` inclusive, `right` exclusive. */
export interface ColumnBand {
  left: number;
  right: number;
}

/** Everything `analyzeTextColumns` measured, including the profile for the
 * debug plot. */
export interface TextColumnAnalysis {
  /** Per column: mean |horizontal| + |vertical| gradient over the text rows,
   * plus a weighted brightness-sum term (see TEXT_COLUMN_BRIGHTNESS_WEIGHT)
   * — a glyph is both an edge and a color departure from its surroundings. */
  profile: number[];
  /** Columns above this count as text. */
  threshold: number;
  /** The text's columns, found by searching inward from each edge for a
   * significant spike (see `spikeEdges`) and cropping at the bottom of the
   * dip right before it, or `null` when the search area holds no stroke
   * energy at all. */
  crop: ColumnBand | null;
  /** How many comparable character strokes (see `spikeCount`) the crop
   * holds, 0 when `crop` is null — how confidently it looks like several
   * characters rather than one solid feature; `fitCropToText` requires at
   * least TEXT_MIN_SPIKES before trusting the crop. */
  spikeCount: number;
  /** How many runs of above-threshold columns (see `aboveThresholdRuns`) the
   * crop holds, minus 1; 0 when `crop` is null or holds at most one. For
   * telemetry: how many separate characters the crop actually spans. */
  mergedRunCount: number;
}

/** The text's columns: searching inward from the search area's left edge,
 * then separately from its right edge, for the first significant spike (see
 * `spikeEdges`) — a column whose stroke+brightness energy both nears the
 * strongest real character elsewhere in the search area and rose there from
 * a genuine dip or decay, not from already being high at the edge. Each
 * side's crop point is the bottom of that dip, right before the spike. */
export function analyzeTextColumns(pixels: GrayscalePixels, band: RowBand): TextColumnAnalysis {
  const textHeight = band.bottom - band.top;
  const bandCrop = cropToRows(pixels, band);
  const strokeProfile = columnStrokeProfile(bandCrop);
  const brightnessProfile = columnBrightnessProfile(bandCrop);
  const profile = strokeProfile.map((value, x) => value + TEXT_COLUMN_BRIGHTNESS_WEIGHT * brightnessProfile[x]!);
  // Anchored to the profile's own deepest dip (the best estimate of true
  // background here), not a flat fraction of the reference column — a
  // genuinely weaker character (e.g. one OCR struggles with) still clears
  // this without having to compete with the strongest characters' peak.
  const backgroundLevel = Math.min(...profile);
  const peakReference = percentile(profile, TEXT_COLUMN_REFERENCE_PERCENTILE);
  const threshold = backgroundLevel + TEXT_COLUMN_BACKGROUND_THRESHOLD_FRACTION * (peakReference - backgroundLevel);

  const marginPx = Math.round(TEXT_COLUMN_EDGE_MARGIN_TEXT_HEIGHTS * textHeight);
  const crop = spikeEdges(profile, marginPx);
  if (!crop) {
    return { profile, threshold, crop: null, spikeCount: 0, mergedRunCount: 0 };
  }

  // Not what decided the crop (that's spikeEdges, above) — just a read on
  // how many comparable character strokes ended up inside it, for
  // `fitCropToText`'s confidence gate and telemetry.
  const runsInCrop = aboveThresholdRuns(profile, threshold).filter((run) => run.left >= crop.left && run.right <= crop.right);
  return {
    profile,
    threshold,
    crop,
    spikeCount: runsInCrop.length === 0 ? 0 : spikeCount(profile, runsInCrop),
    mergedRunCount: Math.max(0, runsInCrop.length - 1),
  };
}

/** The text's left and right columns: scanning in from each edge of
 * `profile` for the first `findSpike` match, each then cropped at the bottom
 * of the dip right before it (see `valleyBottom`) — `null` when no spike is
 * found from one side or the other (e.g. a uniform search area with no
 * stroke energy at all). */
function spikeEdges(profile: readonly number[], marginPx: number): ColumnBand | null {
  // Columns within marginPx of either edge are excluded from the reference:
  // a climb that hasn't turned over within view by the edge of the search
  // area (e.g. glare or vignetting) shouldn't be able to set the scale every
  // real character is judged against.
  const interior = profile.slice(marginPx, Math.max(marginPx, profile.length - marginPx));
  const candidateMax = Math.max(0, ...(interior.length > 0 ? interior : profile));
  if (candidateMax <= 0) {
    return null;
  }

  const spikeThreshold = TEXT_COLUMN_SPIKE_FRACTION * candidateMax;
  const riseThreshold = TEXT_COLUMN_SPIKE_RISE_FRACTION * candidateMax;
  const leftSpike = findSpike(profile, spikeThreshold, riseThreshold, 1);
  const rightSpike = findSpike(profile, spikeThreshold, riseThreshold, -1);
  if (leftSpike === null || rightSpike === null) {
    return null;
  }
  return {
    left: valleyBottom(profile, 0, leftSpike, false),
    // Profile column x spans pixels x and x+1, hence the +1 on the right.
    right: valleyBottom(profile, rightSpike + 1, profile.length, true) + 1,
  };
}

/** Scanning from the start (`direction` 1) or end (`direction` -1) of
 * `profile`, the first index whose value clears `spikeThreshold` and has
 * risen by at least `riseThreshold` from the lowest point seen so far in
 * this scan — confirming a real dip or decay came before it, rather than
 * this edge of the search area already starting high. `null` if the scan
 * finds no such index. */
function findSpike(profile: readonly number[], spikeThreshold: number, riseThreshold: number, direction: 1 | -1): number | null {
  let runningMin = Infinity;
  const start = direction === 1 ? 0 : profile.length - 1;
  for (let x = start; x >= 0 && x < profile.length; x += direction) {
    const value = profile[x]!;
    if (value >= spikeThreshold && value - runningMin >= riseThreshold) {
      return x;
    }
    runningMin = Math.min(runningMin, value);
  }
  return null;
}

/** `band` grown by TEXT_BAND_MARGIN_FRACTION of its height on each side,
 * clamped to `[0, areaHeight]`. */
function withMargin(band: RowBand, areaHeight: number): RowBand {
  const margin = Math.round(TEXT_BAND_MARGIN_FRACTION * (band.bottom - band.top));
  return {
    top: Math.max(0, band.top - margin),
    bottom: Math.min(areaHeight, band.bottom + margin),
  };
}

/** The run of rows above the threshold around the profile's peak (`band` null
 * when the peak doesn't stand out from the median (background) row by at
 * least TEXT_BAND_MIN_PEAK_TO_BACKGROUND), alongside that ratio itself —
 * computed once here for both the pass/fail check and TextRowAnalysis's
 * `peakToBackgroundRatio`. */
function findBand(
  profile: readonly number[],
): { peakToBackgroundRatio: number; band: RowBand; threshold: number } | { peakToBackgroundRatio: number; band: null } {
  if (profile.length === 0) {
    return { peakToBackgroundRatio: 0, band: null };
  }
  const max = Math.max(...profile);
  const med = median(profile);
  // A flat (all-background) profile has med 0: unbounded headroom, not none.
  const peakToBackgroundRatio = max <= 0 ? 0 : med <= 0 ? Infinity : max / med;
  if (peakToBackgroundRatio < TEXT_BAND_MIN_PEAK_TO_BACKGROUND) {
    return { peakToBackgroundRatio, band: null };
  }

  const min = Math.min(...profile);
  const threshold = min + TEXT_BAND_ENERGY_THRESHOLD_FRACTION * (max - min);
  const peak = profile.indexOf(max);

  let top = peak;
  while (top > 0 && profile[top - 1]! > threshold) {
    top--;
  }
  let bottom = peak + 1;
  while (bottom < profile.length && profile[bottom]! > threshold) {
    bottom++;
  }
  return { peakToBackgroundRatio, band: { top, bottom }, threshold };
}

/** The rows between the nearest horizontal lines above and below `band` (line
 * row y is the edge between rows y and y+1); the whole area if none. */
function lineBounds(lineProfile: readonly number[], lineThreshold: number, band: RowBand, height: number): RowBand {
  let top = 0;
  for (let y = band.top - 1; y >= 0; y--) {
    if (lineProfile[y]! > lineThreshold) {
      top = y + 1;
      break;
    }
  }
  let bottom = height;
  for (let y = band.bottom; y < lineProfile.length; y++) {
    if (lineProfile[y]! > lineThreshold) {
      bottom = y + 1;
      break;
    }
  }
  return { top, bottom };
}

/** Mean absolute horizontal gradient of each row. Empty for images narrower
 * than 2px. */
function rowGradientProfile({ data, width, height }: GrayscalePixels): number[] {
  if (width < 2) {
    return [];
  }
  return Array.from({ length: height }, (_, y) => {
    let sum = 0;
    for (let x = 0; x < width - 1; x++) {
      sum += Math.abs(data[y * width + x + 1]! - data[y * width + x]!);
    }
    return sum / (width - 1);
  });
}

/** Mean absolute vertical gradient between each row and the next (one
 * fewer entry than rows). */
function rowEdgeProfile({ data, width, height }: GrayscalePixels): number[] {
  return Array.from({ length: Math.max(0, height - 1) }, (_, y) => {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += Math.abs(data[(y + 1) * width + x]! - data[y * width + x]!);
    }
    return sum / width;
  });
}

/** `pixels` restricted to `band`'s rows, zero-copy — the second crop every
 * per-column measure operates on, so column detection never sees anything
 * outside the detected text line. */
function cropToRows({ data, width }: GrayscalePixels, band: RowBand): GrayscalePixels {
  return { data: data.subarray(band.top * width, band.bottom * width), width, height: band.bottom - band.top };
}

/** Mean stroke energy of each column over `crop`'s rows: horizontal plus
 * vertical gradient, so both upright and flat glyph strokes count. `crop` is
 * already restricted to the text band (see `cropToRows`) rather than this
 * function restricting which rows it visits itself, so the vertical gradient
 * at the band's last row never leaks into whatever's just outside it (e.g.
 * card art, another line) — that leak previously inflated some columns'
 * energy for reasons unrelated to the band's own strokes. One fewer entry
 * than columns. */
function columnStrokeProfile({ data, width, height }: GrayscalePixels): number[] {
  return Array.from({ length: Math.max(0, width - 1) }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      sum += Math.abs(data[i + 1]! - data[i]!);
      if (y + 1 < height) {
        sum += Math.abs(data[i + width]! - data[i]!);
      }
    }
    return sum / height;
  });
}

/** Per column, the sum over `crop`'s rows of how far each pixel departs from
 * the crop's own median brightness (the best single estimate of its
 * background) — a background column sums close to 0, while a column with
 * ink running through it (lighter or darker than the background) sums high.
 * Same length as `columnStrokeProfile`'s result, not one shorter: every
 * column has a brightness, unlike a between-column gradient. */
function columnBrightnessProfile({ data, width, height }: GrayscalePixels): number[] {
  const backgroundLevel = median(Array.from(data));
  return Array.from({ length: width }, (_, x) => {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += Math.abs(data[y * width + x]! - backgroundLevel);
    }
    return sum;
  });
}

/** The index of `profile`'s lowest value in `[start, end)`. Ties break
 * towards `end` when `awayFromTextIsLater` (the right-side search, where
 * farther from the text is a larger index) and towards `start` otherwise
 * (the left-side search) — either way, a flat (or equally low) background
 * reaches all the way to the search window's far edge, the same reach as the
 * old fixed margin, rather than snapping to the nearest point merely tied
 * for lowest; a genuine single dip still wins outright since nothing past it
 * is as low. */
function valleyBottom(profile: readonly number[], start: number, end: number, awayFromTextIsLater: boolean): number {
  let bottom = start;
  for (let x = start; x < end; x++) {
    if (awayFromTextIsLater ? profile[x]! <= profile[bottom]! : profile[x]! < profile[bottom]!) {
      bottom = x;
    }
  }
  return bottom;
}

/** Maximal runs of consecutive entries above `threshold`, left to right. */
function aboveThresholdRuns(profile: readonly number[], threshold: number): ColumnBand[] {
  const runs: ColumnBand[] = [];
  let start: number | null = null;
  profile.forEach((value, x) => {
    if (value > threshold && start === null) {
      start = x;
    } else if (value <= threshold && start !== null) {
      runs.push({ left: start, right: x });
      start = null;
    }
  });
  if (start !== null) {
    runs.push({ left: start, right: profile.length });
  }
  return runs;
}

function energyOf(profile: readonly number[], run: ColumnBand): number {
  return profile.slice(run.left, run.right).reduce((sum, value) => sum + value, 0);
}

/** How many of `group`'s runs have a per-column average energy within
 * TEXT_RUN_SIGNIFICANCE_FRACTION of its strongest: a narrow character (e.g.
 * "1") concentrates similar total energy into fewer columns than a wider one
 * (e.g. "3"), so comparing per-column averages — not each run's total energy
 * — doesn't let stroke width alone make a real character look weaker than
 * another. A solid feature's incidental edge noise still reads far weaker per
 * column than its own bulk, so it doesn't inflate the count. */
function spikeCount(profile: readonly number[], group: readonly ColumnBand[]): number {
  const averages = group.map((run) => energyOf(profile, run) / (run.right - run.left));
  const strongest = Math.max(...averages);
  return averages.filter((average) => average >= TEXT_RUN_SIGNIFICANCE_FRACTION * strongest).length;
}

/** The value at fraction `p` (0-1) of the sorted values; 0 when empty. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))]!;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}
