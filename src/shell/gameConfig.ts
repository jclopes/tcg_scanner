import type { GameConfig, RegionType } from "../core";
import cyberpunk2077Tcg from "../data/games/cyberpunk-2077-tcg.json";

/** The on-disk shape of a `src/data/games/*.json` region config — snake_case,
 * per the format documented in docs/plan/06-card-identification.md. Distinct
 * from `GameConfig`/`RegionConfig` (src/core/identification.ts), which use
 * camelCase — this module's job is exactly that translation. */
interface RawRegionConfig {
  label: string;
  type: RegionType;
  allowed_chars_regex?: string;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  height_mm: number;
  rotation_deg?: number;
  max_gap_text_heights?: number;
}

interface RawGameConfig {
  game: string;
  regions: RawRegionConfig[];
}

/**
 * Every bundled game's region config, keyed by its `game` id — a plain
 * `import` (Vite/TS both resolve `.json` imports natively, per
 * tsconfig.json's `resolveJsonModule`), not a `fetch`, since these are
 * small, build-time-known files shipped with the app rather than loaded
 * from a server. Only one game is bundled so far (see
 * docs/plan/06-card-identification.md's "Out of scope" — one config per
 * game to start); this map is exactly where a future game selector UI
 * would read its list of choices from.
 */
const RAW_GAME_CONFIGS: Record<string, RawGameConfig> = {
  "cyberpunk-2077-tcg": cyberpunk2077Tcg as RawGameConfig,
};

/**
 * Looks up `game`'s bundled region config and translates it from its
 * on-disk snake_case shape into the functional core's `GameConfig`.
 * Synchronous — no network/async work, since RAW_GAME_CONFIGS is already
 * resolved at build/import time.
 *
 * Throws if `game` isn't one of RAW_GAME_CONFIGS' keys — there's no
 * sensible fallback (a made-up config would silently mis-identify cards),
 * and per this project's "explicit over implicit" principle a missing
 * config should fail loudly, not degrade quietly.
 */
export function loadGameConfig(game: string): GameConfig {
  const raw = RAW_GAME_CONFIGS[game];
  if (!raw) {
    throw new Error(`No bundled region config for game "${game}".`);
  }
  return {
    game: raw.game,
    regions: raw.regions.map((region) => ({
      label: region.label,
      type: region.type,
      xMm: region.x_mm,
      yMm: region.y_mm,
      widthMm: region.width_mm,
      heightMm: region.height_mm,
      rotationDeg: region.rotation_deg,
      allowedCharsRegex: region.allowed_chars_regex,
      maxGapTextHeights: region.max_gap_text_heights,
    })),
  };
}
