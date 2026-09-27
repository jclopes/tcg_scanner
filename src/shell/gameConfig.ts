/// <reference types="vite/client" />
import type { CardPrintFormat, GameConfig, RegionConfig } from "../core";

/** The on-disk shape of a region in `src/data/games/<game>/regions.json` —
 * snake_case, per docs/plan/06-card-identification.md. `parseRegion`
 * translates it into the core's camelCase `RegionConfig`. */
export interface RawRegionConfig {
  label: string;
  type: string;
  allowed_chars_regex?: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  rotation_deg?: number;
  max_gap_text_heights?: number;
}

export interface RawGameConfig {
  game: string;
  card_formats: unknown;
  foil: unknown;
  regions: RawRegionConfig[];
}

export interface RawSetConfig {
  code: string;
  name: string;
  print: unknown;
  collector_numbers: string[];
}

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
 * config, its sets, the print formats its cards come in (the first is the
 * default) and whether it has foil cards. */
export interface GameOption {
  id: string;
  config: GameConfig;
  sets: GameSet[];
  cardFormats: CardPrintFormat[];
  hasFoil: boolean;
}

/** Every game folder's regions.json and sets.json, keyed by folder name —
 * gathered at build time by Vite's `import.meta.glob`. */
const RAW_GAME_CONFIGS = byGameFolder(
  import.meta.glob<RawGameConfig>("../data/games/*/regions.json", { eager: true, import: "default" }),
);
const RAW_SET_CONFIGS = byGameFolder(
  import.meta.glob<RawSetConfig[]>("../data/games/*/sets.json", { eager: true, import: "default" }),
);

/**
 * Every bundled game, sorted alphabetically by id, each with its sets sorted
 * alphabetically by name. Throws if there are no games, if a game folder is
 * missing its regions.json or sets.json, if a game has no sets, or if a
 * region is invalid (see parseRegion).
 */
export function listGames(): GameOption[] {
  const ids = [...new Set([...Object.keys(RAW_GAME_CONFIGS), ...Object.keys(RAW_SET_CONFIGS)])];
  if (ids.length === 0) {
    throw new Error("No games found under src/data/games/.");
  }
  return ids.sort((a, b) => a.localeCompare(b)).map((id) => parseGame(id, RAW_GAME_CONFIGS[id], RAW_SET_CONFIGS[id]));
}

/** Parses one game folder's files. Throws if either is missing, there are no
 * sets, or a field is invalid. */
export function parseGame(id: string, rawConfig: RawGameConfig | undefined, rawSets: RawSetConfig[] | undefined): GameOption {
  if (!rawConfig || !rawSets) {
    throw new Error(`Game folder "${id}" must contain both regions.json and sets.json.`);
  }
  if (rawSets.length === 0) {
    throw new Error(`Game "${id}" has no sets in its sets.json.`);
  }
  return {
    id,
    config: { game: rawConfig.game, regions: rawConfig.regions.map((region) => parseRegion(id, region)) },
    sets: rawSets
      .map((set) => parseSet(id, set))
      .sort((a, b) => a.name.localeCompare(b.name)),
    cardFormats: parseCardFormats(id, rawConfig.card_formats),
    hasFoil: parseFoil(id, rawConfig.foil),
  };
}

function parseSet(gameId: string, raw: RawSetConfig): GameSet {
  if (typeof raw.print !== "string" || raw.print === "") {
    throw new Error(`Set "${raw.code}" of game "${gameId}" needs a "print": the set code printed on its cards.`);
  }
  return { code: raw.code, name: raw.name, print: raw.print, collectorNumbers: raw.collector_numbers };
}

/** `card_formats`: a non-empty list of distinct "portrait"/"landscape". */
function parseCardFormats(gameId: string, raw: unknown): CardPrintFormat[] {
  const valid =
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((format) => format === "portrait" || format === "landscape") &&
    new Set(raw).size === raw.length;
  if (!valid) {
    throw new Error(
      `Game "${gameId}" needs "card_formats": a list of distinct "portrait"/"landscape", got ${JSON.stringify(raw)}.`,
    );
  }
  return raw as CardPrintFormat[];
}

function parseFoil(gameId: string, raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new Error(`Game "${gameId}" needs "foil": true or false, got ${JSON.stringify(raw)}.`);
  }
  return raw;
}

/** Translates one raw region into a `RegionConfig`. Throws on an unknown
 * `type` or a text region without `allowed_chars_regex`. */
export function parseRegion(gameId: string, raw: RawRegionConfig): RegionConfig {
  const box = {
    label: raw.label,
    xMm: raw.x_mm,
    yMm: raw.y_mm,
    widthMm: raw.width_mm,
    heightMm: raw.height_mm,
    rotationDeg: raw.rotation_deg,
  };
  switch (raw.type) {
    case "image":
      return { ...box, type: "image" };
    case "text":
      if (raw.allowed_chars_regex === undefined) {
        throw new Error(`Text region "${raw.label}" of game "${gameId}" has no allowed_chars_regex.`);
      }
      return {
        ...box,
        type: "text",
        allowedCharsRegex: raw.allowed_chars_regex,
        maxGapTextHeights: raw.max_gap_text_heights,
      };
    default:
      throw new Error(`Region "${raw.label}" of game "${gameId}" has unknown type "${raw.type}".`);
  }
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
