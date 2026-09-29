/// <reference types="vite/client" />
import {
  optionalNumber,
  requireArray,
  requireBoolean,
  requireList,
  requireNumber,
  requireRecord,
  requireString,
  requireStringArray,
  requireUnique,
} from "../core";
import type { CardOrientation, GameConfig, RegionConfig } from "../core";

/** One set a game's cards can be scanned from, as listed in its sets.json. */
export interface GameSet {
  code: string;
  name: string;
  /** The set code as printed on its cards, e.g. "MS01 - WNC [A]". */
  print: string;
  /** Every card ID in the set, in print order. */
  collectorNumbers: string[];
}

/** A bundled game: its folder name under src/data/games/, its parsed region
 * config, its sets, the orientations its cards are printed in (the first is the
 * default) and whether it has foil cards. */
export interface GameOption {
  id: string;
  config: GameConfig;
  sets: GameSet[];
  cardOrientations: CardOrientation[];
  hasFoil: boolean;
}

/** Every game folder's regions.json and sets.json, keyed by folder name —
 * gathered at build time by Vite's `import.meta.glob`, still unchecked JSON
 * (see parseGame). */
const RAW_GAME_CONFIGS = byGameFolder(
  import.meta.glob<unknown>("../data/games/*/regions.json", { eager: true, import: "default" }),
);
const RAW_SET_CONFIGS = byGameFolder(
  import.meta.glob<unknown>("../data/games/*/sets.json", { eager: true, import: "default" }),
);

/**
 * Every bundled game, sorted alphabetically by id, each with its sets sorted
 * alphabetically by name. Throws if there are no games or any game's data is
 * invalid (see parseGame).
 */
export function listGames(): GameOption[] {
  const ids = [...new Set([...Object.keys(RAW_GAME_CONFIGS), ...Object.keys(RAW_SET_CONFIGS)])];
  if (ids.length === 0) {
    throw new Error("No games found under src/data/games/.");
  }
  return ids.sort((a, b) => a.localeCompare(b)).map((id) => parseGame(id, RAW_GAME_CONFIGS[id], RAW_SET_CONFIGS[id]));
}

/**
 * Parses and checks one game folder's regions.json and sets.json. Throws,
 * naming the file, entry and field, if either file is missing, a field is
 * missing or of the wrong type, there are no sets, or region labels, set
 * codes or a set's collector numbers repeat.
 */
export function parseGame(id: string, rawConfig: unknown, rawSets: unknown): GameOption {
  if (rawConfig === undefined || rawSets === undefined) {
    throw new Error(`Game folder "${id}" must contain both regions.json and sets.json.`);
  }
  const configContext = `Game "${id}" regions.json`;
  const config = requireRecord(rawConfig, configContext);
  const regions = requireArray(config, "regions", configContext).map((region) => parseRegion(id, region));
  requireUnique(
    regions.map((region) => region.label),
    "region labels",
    configContext,
  );

  const setsContext = `Game "${id}" sets.json`;
  const sets = requireList(rawSets, setsContext).map((set) => parseSet(setsContext, set));
  if (sets.length === 0) {
    throw new Error(`${setsContext} has no sets.`);
  }
  requireUnique(
    sets.map((set) => set.code),
    "set codes",
    setsContext,
  );

  return {
    id,
    config: { game: requireString(config, "game", configContext), regions },
    sets: sets.sort((a, b) => a.name.localeCompare(b.name)),
    cardOrientations: parseCardOrientations(config, configContext),
    hasFoil: requireBoolean(config, "foil", configContext),
  };
}

function parseSet(setsContext: string, raw: unknown): GameSet {
  const set = requireRecord(raw, `${setsContext} set`);
  const code = requireString(set, "code", `${setsContext} set`);
  const context = `${setsContext} set "${code}"`;
  return {
    code,
    name: requireString(set, "name", context),
    print: requireString(set, "print", context),
    collectorNumbers: requireStringArray(set, "collector_numbers", context),
  };
}

/** `card_orientation`: a non-empty list of distinct "portrait"/"landscape". */
function parseCardOrientations(config: Record<string, unknown>, context: string): CardOrientation[] {
  const orientations = requireStringArray(config, "card_orientation", context);
  const unknown = orientations.find((orientation) => orientation !== "portrait" && orientation !== "landscape");
  if (unknown !== undefined) {
    throw new Error(`${context}: "card_orientation" can only hold "portrait"/"landscape", got "${unknown}".`);
  }
  return orientations as CardOrientation[];
}

/** Translates one raw region into a `RegionConfig`. Throws on a missing or
 * mistyped field, a non-positive size, an unknown `type`, or a text region
 * without a valid `allowed_chars_regex`. */
export function parseRegion(gameId: string, raw: unknown): RegionConfig {
  const regionsContext = `Game "${gameId}" regions.json region`;
  const record = requireRecord(raw, regionsContext);
  const label = requireString(record, "label", regionsContext);
  const context = `${regionsContext} "${label}"`;
  const box = {
    label,
    xMm: requireNumber(record, "x_mm", context),
    yMm: requireNumber(record, "y_mm", context),
    widthMm: requirePositive(record, "width_mm", context),
    heightMm: requirePositive(record, "height_mm", context),
    rotationDeg: optionalNumber(record, "rotation_deg", context),
  };
  const type = requireString(record, "type", context);
  switch (type) {
    case "image":
      return { ...box, type: "image" };
    case "text":
      return {
        ...box,
        type: "text",
        allowedCharsRegex: requireRegex(record, "allowed_chars_regex", context),
        maxGapTextHeights: optionalNumber(record, "max_gap_text_heights", context),
      };
    default:
      throw new Error(`${context} has unknown type "${type}".`);
  }
}

function requirePositive(record: Record<string, unknown>, key: string, context: string): number {
  const value = requireNumber(record, key, context);
  if (value <= 0) {
    throw new Error(`${context}: "${key}" must be positive, got ${value}.`);
  }
  return value;
}

/** A string field that must compile as a regular expression. */
function requireRegex(record: Record<string, unknown>, key: string, context: string): string {
  const pattern = requireString(record, key, context);
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new Error(`${context}: "${key}" isn't a valid regular expression: ${(error as Error).message}`);
  }
  return pattern;
}

/** Re-keys a glob result from `../data/games/<game>/<file>.json` to `<game>`. */
function byGameFolder<T>(modules: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, module]) => {
      const folder = path.split("/").at(-2);
      if (!folder) {
        throw new Error(`Unexpected game data path: ${path}`);
      }
      return [folder, module];
    }),
  );
}
