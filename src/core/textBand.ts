import {
  HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND,
  TEXT_BAND_ENERGY_THRESHOLD_FRACTION,
  TEXT_BAND_MARGIN_FRACTION,
  TEXT_BAND_MIN_PEAK_TO_BACKGROUND,
  TEXT_COLUMN_ENERGY_THRESHOLD_FRACTION,
  TEXT_COLUMN_MARGIN_TEXT_HEIGHTS,
  TEXT_COLUMN_REFERENCE_PERCENTILE,
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
}

/** The rows to crop a search area to: the run around the strongest
 * glyph-stroke row (if it stands out from the median by
 * TEXT_BAND_MIN_PEAK_TO_BACKGROUND), plus a margin that stops at strong
 * horizontal lines (e.g. a badge border). */
export function analyzeTextRows(pixels: GrayscalePixels): TextRowAnalysis {
  const textProfile = rowGradientProfile(pixels);
  const lineProfile = rowEdgeProfile(pixels);
  const backgroundLineThreshold = HORIZONTAL_LINE_MIN_ENERGY_TO_BACKGROUND * median(lineProfile);
  const found = findBand(textProfile);

  if (!found) {
    return {
      textProfile,
      textThreshold: 0,
      lineProfile,
      lineThreshold: backgroundLineThreshold,
      band: null,
      crop: null,
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
  /** Per column: mean |horizontal| + |vertical| gradient over the text rows. */
  profile: number[];
  /** Columns above this count as text. */
  threshold: number;
  /** The text line's columns plus margin, or `null` when the rows hold no
   * stroke energy at all. */
  crop: ColumnBand | null;
}

/** The text line's columns within rows `band`: runs of strong columns grouped
 * across gaps up to `maxGapTextHeights`; the group with the most stroke
 * energy wins, so a narrow strong feature (e.g. the card's edge) can't. Plus a
 * margin. */
export function analyzeTextColumns(
  pixels: GrayscalePixels,
  band: RowBand,
  maxGapTextHeights: number,
): TextColumnAnalysis {
  const profile = columnStrokeProfile(pixels, band);
  const threshold = TEXT_COLUMN_ENERGY_THRESHOLD_FRACTION * percentile(profile, TEXT_COLUMN_REFERENCE_PERCENTILE);
  const runs = aboveThresholdRuns(profile, threshold);
  if (runs.length === 0) {
    return { profile, threshold, crop: null };
  }

  const textHeight = band.bottom - band.top;
  const groups = groupRuns(runs, maxGapTextHeights * textHeight);
  const text = maxBy(groups, (group) => group.reduce((sum, run) => sum + energyOf(profile, run), 0));
  const left = text[0]!.left;
  const right = text[text.length - 1]!.right;

  // Profile column x spans pixels x and x+1, hence the +1 on the right.
  const margin = Math.round(TEXT_COLUMN_MARGIN_TEXT_HEIGHTS * textHeight);
  return {
    profile,
    threshold,
    crop: { left: Math.max(0, left - margin), right: Math.min(pixels.width, right + 1 + margin) },
  };
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

/** The run of rows above the threshold around the profile's peak, or `null`
 * when the peak doesn't stand out from the median (background) row. */
function findBand(profile: readonly number[]): { band: RowBand; threshold: number } | null {
  if (profile.length === 0) {
    return null;
  }
  const max = Math.max(...profile);
  if (max <= 0 || max < TEXT_BAND_MIN_PEAK_TO_BACKGROUND * median(profile)) {
    return null;
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
  return { band: { top, bottom }, threshold };
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

/** Mean stroke energy of each column over the rows in `band`: horizontal plus
 * vertical gradient, so both upright and flat glyph strokes count. One fewer
 * entry than columns. */
function columnStrokeProfile({ data, width, height }: GrayscalePixels, band: RowBand): number[] {
  const rows = band.bottom - band.top;
  return Array.from({ length: Math.max(0, width - 1) }, (_, x) => {
    let sum = 0;
    for (let y = band.top; y < band.bottom; y++) {
      const i = y * width + x;
      sum += Math.abs(data[i + 1]! - data[i]!);
      if (y + 1 < height) {
        sum += Math.abs(data[i + width]! - data[i]!);
      }
    }
    return sum / rows;
  });
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

/** Consecutive runs (left to right) split wherever the gap between two runs
 * exceeds `maxGap`. `runs` must be non-empty. */
function groupRuns(runs: readonly ColumnBand[], maxGap: number): ColumnBand[][] {
  const groups: ColumnBand[][] = [[runs[0]!]];
  for (const run of runs.slice(1)) {
    const current = groups[groups.length - 1]!;
    if (run.left - current[current.length - 1]!.right > maxGap) {
      groups.push([run]);
    } else {
      current.push(run);
    }
  }
  return groups;
}

function energyOf(profile: readonly number[], run: ColumnBand): number {
  return profile.slice(run.left, run.right).reduce((sum, value) => sum + value, 0);
}

/** The first item with the highest `score`. `items` must be non-empty. */
function maxBy<T>(items: readonly T[], score: (item: T) => number): T {
  return items.reduce((best, item) => (score(item) > score(best) ? item : best));
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
