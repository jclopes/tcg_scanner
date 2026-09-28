// Pure fuzzy matching of OCR'd card text against a set's known card IDs.
// See docs/plan/06-card-identification.md ("ID dataset format").

import { MAX_CONFIDENT_MATCH_DISTANCE } from "./constants";

/** One candidate ID ranked against the OCR'd text: `distance` is the edit
 * distance between them (0 = exact match). */
export interface CardIdMatch {
  id: string;
  distance: number;
}

/**
 * Ranks `candidates` by edit distance to `ocrText`, closest first, and keeps
 * the best `limit`. Ties keep `candidates`' own order (a set's IDs are listed
 * in print order). Empty `ocrText` means OCR read nothing, so there is
 * nothing to match: returns no suggestions rather than the `limit` shortest
 * IDs.
 */
export function rankCardIds(ocrText: string, candidates: readonly string[], limit: number): CardIdMatch[] {
  if (ocrText === "") {
    return [];
  }
  return candidates
    .map((id) => ({ id, distance: levenshteinDistance(ocrText, id) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/** Whether the best of `matches` (ranked by rankCardIds) is within
 * MAX_CONFIDENT_MATCH_DISTANCE. False when there are none, i.e. OCR read no
 * text. */
export function isConfidentMatch(matches: readonly CardIdMatch[]): boolean {
  const best = matches[0];
  return best !== undefined && best.distance <= MAX_CONFIDENT_MATCH_DISTANCE;
}

/**
 * The sets whose printed code the OCR'd set code reads closer to than the
 * selected set's — all tied at the closest distance, in `sets` order. Empty
 * when the selected set is (joint) closest or OCR read nothing. Distances
 * ignore whitespace (OCR spacing is unreliable) but not case.
 */
export function closerSetPrints<T extends { print: string }>(ocrText: string, selected: T, sets: readonly T[]): T[] {
  const read = withoutWhitespace(ocrText);
  if (read === "") {
    return [];
  }
  const distanceTo = (set: T): number => levenshteinDistance(read, withoutWhitespace(set.print));
  const selectedDistance = distanceTo(selected);
  const closest = Math.min(...sets.map(distanceTo));
  return closest < selectedDistance ? sets.filter((set) => distanceTo(set) === closest) : [];
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

/** The entry of `candidates` equal to the typed `query`, ignoring case and
 * surrounding whitespace (so "005A" finds "005a"), or null if the set has no
 * such card. */
export function findCardId(query: string, candidates: readonly string[]): string | null {
  const normalized = query.trim().toLowerCase();
  return candidates.find((id) => id.toLowerCase() === normalized) ?? null;
}

/** The minimum number of single-character insertions, deletions and
 * substitutions turning `a` into `b`. Compares UTF-16 code units, which is
 * exact for the BMP characters card IDs use (e.g. "β"). */
export function levenshteinDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}
