/** The set code printed on the cards isn't published by the site, so `print`
 * is kept from the local sets.json; a new set gets this until it's filled in
 * by hand. */
export const PRINT_PLACEHOLDER = "TODO";

/** Beta prints' collector numbers start with this (see gameConfig.ts's
 * GameSet.collectorNumberPrefix). */
const BETA_PREFIX = "β";

/** `raw`, a collector number as the site spells it, zero-padded to the 3
 * digits the cards print: the site has a few unpadded, e.g. "10" for 010. */
export function normalizeCollectorNumber(raw) {
  const match = /^(β?)(\d+)([a-z]?)$/.exec(raw);
  if (match === null) {
    throw new Error(`Unexpected collector number "${raw}".`);
  }
  const [, prefix, digits, suffix] = match;
  return `${prefix}${digits.padStart(3, "0")}${suffix}`;
}

/** The sets.json entry for the site's set `option` ({code, name}) holding the
 * collector numbers `rawNumbers`, with `print` kept from `localSet` (the
 * current entry, or undefined for a set the local file doesn't have yet). */
export function buildSet(option, rawNumbers, localSet) {
  const collectorNumbers = [...new Set(rawNumbers.map(normalizeCollectorNumber))].sort();
  if (collectorNumbers.length === 0) {
    throw new Error(`Set "${option.code}" has no cards on the site.`);
  }
  const isBeta = collectorNumbers.every((number) => number.startsWith(BETA_PREFIX));
  return {
    code: option.code,
    print: localSet === undefined ? PRINT_PLACEHOLDER : localSet.print,
    name: option.name,
    ...(isBeta ? { collector_number_prefix: BETA_PREFIX } : {}),
    collector_numbers: collectorNumbers,
  };
}
