/// <reference types="vite/client" />
import {
  DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
  DEFAULT_TEXT_EXTRACT_REGEX,
  DEFAULT_TEXT_SEARCH_PADDING_Y_MM,
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

/** The text regions identification reads; every orientation's layout must
 * have both. */
export const COLLECTOR_NUMBER_REGION = "collector_number";
export const SET_CODE_REGION = "set_code";

/** One set a game's cards can be scanned from, as listed in its sets.json. */
export interface GameSet {
  code: string;
  name: string;
  /** The set code as printed on its cards, e.g. "MS01 - WNC [A]". */
  print: string;
  /** Every card ID in the set, in print order. */
  collectorNumbers: string[];
}

/** A bundled game's layout, from its regions.json: its folder name under
 * src/data/games/, its parsed region config, the orientations its cards are
 * printed in (the first is the default) and whether it has foil cards. */
export interface GameOption {
  id: string;
  config: GameConfig;
  cardOrientations: CardOrientation[];
  hasFoil: boolean;
}

/** A game with its sets loaded (see loadGame). */
export type Game = GameOption & { sets: GameSet[] };

/** The set dropdown's choice: one set, or "autodetect" — the set whose printed
 * code the card's set code reads closest to (see closestSetPrint). */
export type SetChoice = GameSet | "autodetect";

/** Every game folder's regions.json, keyed by folder name — bundled by Vite's
 * `import.meta.glob`, still unchecked JSON (see parseGameOption). */
const RAW_GAME_CONFIGS = byGameFolder(
  import.meta.glob<unknown>("../data/games/*/regions.json", { eager: true, import: "default" }),
);
/** Every game folder's sets.json loader, keyed by folder name. Not eager, so
 * Vite emits each game's sets as its own chunk, downloaded on first use. */
const SET_LOADERS = byGameFolder(import.meta.glob<unknown>("../data/games/*/sets.json", { import: "default" }));

/** Every bundled game by id. Throws if there are none, a folder lacks
 * regions.json or sets.json, or a regions.json is invalid (see
 * parseGameOption). */
export function listGames(): GameOption[] {
  const ids = [...new Set([...Object.keys(RAW_GAME_CONFIGS), ...Object.keys(SET_LOADERS)])];
  if (ids.length === 0) {
    throw new Error("No games found under src/data/games/.");
  }
  return ids
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      if (RAW_GAME_CONFIGS[id] === undefined || SET_LOADERS[id] === undefined) {
        throw new Error(`Game folder "${id}" must contain both regions.json and sets.json.`);
      }
      return parseGameOption(id, RAW_GAME_CONFIGS[id]);
    });
}

/** `game` with its sets.json downloaded and parsed (see parseSets). */
export async function loadGame(game: GameOption): Promise<Game> {
  const loadSets = SET_LOADERS[game.id];
  if (loadSets === undefined) {
    throw new Error(`Game "${game.id}" has no sets.json.`);
  }
  return { ...game, sets: parseSets(game.id, await loadSets()) };
}

/** Parses one game folder's regions.json. Throws, naming the entry and field,
 * on anything missing, mistyped or repeated. */
export function parseGameOption(id: string, rawConfig: unknown): GameOption {
  const context = `Game "${id}" regions.json`;
  const config = requireRecord(rawConfig, context);
  const cardOrientations = parseCardOrientations(config, context);
  return {
    id,
    config: { game: id, regions: parseRegionsByOrientation(id, config, cardOrientations, context) },
    cardOrientations,
    hasFoil: requireBoolean(config, "foil", context),
  };
}

/** Parses one game folder's sets.json, sorted by name. Throws, naming the set
 * and field, on anything missing, mistyped or repeated, or when there are no
 * sets. */
export function parseSets(id: string, rawSets: unknown): GameSet[] {
  const context = `Game "${id}" sets.json`;
  const sets = requireList(rawSets, context).map((set) => parseSet(context, set));
  if (sets.length === 0) {
    throw new Error(`${context} has no sets.`);
  }
  requireUnique(
    sets.map((set) => set.code),
    "set codes",
    context,
  );
  return sets.sort((a, b) => a.name.localeCompare(b.name));
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

/** `regions`: an object with one list of regions per orientation in
 * `card_orientation` — no more, no fewer — each with distinct labels and the
 * text regions identification reads. */
function parseRegionsByOrientation(
  gameId: string,
  config: Record<string, unknown>,
  cardOrientations: readonly CardOrientation[],
  context: string,
): Partial<Record<CardOrientation, RegionConfig[]>> {
  const byOrientation = requireRecord(config.regions, `${context} "regions"`);
  const extra = Object.keys(byOrientation).find((key) => !cardOrientations.includes(key as CardOrientation));
  if (extra !== undefined) {
    throw new Error(`${context}: "regions" has "${extra}", which isn't in "card_orientation".`);
  }
  return Object.fromEntries(
    cardOrientations.map((orientation) => {
      const regions = requireArray(byOrientation, orientation, `${context} "regions"`).map((region) =>
        parseRegion(gameId, orientation, region),
      );
      requireUnique(
        regions.map((region) => region.label),
        `${orientation} region labels`,
        context,
      );
      requireTextRegion(regions, COLLECTOR_NUMBER_REGION, orientation, context);
      requireTextRegion(regions, SET_CODE_REGION, orientation, context);
      return [orientation, regions];
    }),
  );
}

function requireTextRegion(regions: readonly RegionConfig[], label: string, orientation: CardOrientation, context: string): void {
  if (!regions.some((region) => region.label === label && region.type === "text")) {
    throw new Error(`${context}: the ${orientation} regions need a text region labeled "${label}".`);
  }
}

/** One raw region as a `RegionConfig`, with no rotation, the default maximum
 * text gap and search padding, and the whole OCR text as its value when
 * omitted. */
export function parseRegion(gameId: string, orientation: CardOrientation, raw: unknown): RegionConfig {
  const regionsContext = `Game "${gameId}" regions.json ${orientation} region`;
  const record = requireRecord(raw, regionsContext);
  const label = requireString(record, "label", regionsContext);
  const context = `${regionsContext} "${label}"`;
  const box = {
    label,
    xMm: requireNumber(record, "x_mm", context),
    yMm: requireNumber(record, "y_mm", context),
    widthMm: requirePositive(record, "width_mm", context),
    heightMm: requirePositive(record, "height_mm", context),
    rotationDeg: optionalNumber(record, "rotation_deg", context) ?? 0,
  };
  const type = requireString(record, "type", context);
  switch (type) {
    case "image":
      return { ...box, type: "image" };
    case "text":
      return {
        ...box,
        type: "text",
        allowedChars: requireString(record, "allowed_chars", context),
        extractRegex:
          record.extract_regex === undefined ? DEFAULT_TEXT_EXTRACT_REGEX : requireRegex(record, "extract_regex", context),
        maxGapTextHeights: optionalNumber(record, "max_gap_text_heights", context) ?? DEFAULT_TEXT_COLUMN_MAX_GAP_TEXT_HEIGHTS,
        searchPaddingYMm: optionalNumber(record, "search_padding_y_mm", context) ?? DEFAULT_TEXT_SEARCH_PADDING_Y_MM,
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
