import type { Size } from "../core";

/** The user's remembered camera/resolution/game/set/session-tags choices, persisted across
 * sessions (localStorage) so returning users don't have to re-pick them
 * every load. Best-effort only: localStorage can throw (private browsing,
 * disabled storage) or simply be unavailable, and a previously-picked
 * camera/resolution can vanish (device unplugged, browser no longer
 * reports it) — callers must treat every field as optional and fall back
 * to their own defaults rather than assuming a stored value is still
 * valid.
 */
export interface StoredPreferences {
  cameraDeviceId?: string;
  resolution?: Size;
  gameId?: string;
  setCode?: string;
  /** The session-tags input's raw text. */
  sessionTags?: string;
}

const STORAGE_KEY = "tcg-scanner:preferences";

export function loadPreferences(): StoredPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const { cameraDeviceId, resolution, gameId, setCode, sessionTags } = parsed as StoredPreferences;
    return {
      cameraDeviceId: typeof cameraDeviceId === "string" ? cameraDeviceId : undefined,
      resolution: isValidSize(resolution) ? resolution : undefined,
      gameId: typeof gameId === "string" ? gameId : undefined,
      setCode: typeof setCode === "string" ? setCode : undefined,
      sessionTags: typeof sessionTags === "string" ? sessionTags : undefined,
    };
  } catch {
    return {};
  }
}

/** Merges `changes` into the stored preferences, leaving other fields as
 * they were. */
export function savePreferences(changes: StoredPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPreferences(), ...changes }));
  } catch {
    // Best-effort — see StoredPreferences' doc comment.
  }
}

function isValidSize(value: unknown): value is Size {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Size).width === "number" &&
    typeof (value as Size).height === "number"
  );
}
