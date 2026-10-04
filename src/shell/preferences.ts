import type { Size } from "../core";

/** The user's remembered choices, in localStorage. Best-effort: storage can
 * be unavailable and a saved camera can vanish, so every field is optional
 * and callers fall back to their own defaults. */
export interface StoredPreferences {
  cameraDeviceId?: string;
  resolution?: Size;
  gameId?: string;
  setCode?: string;
  /** The session-tags input's raw text. */
  sessionTags?: string;
  sound?: boolean;
}

const STORAGE_KEY = "tcg-scanner:preferences";

export function loadPreferences(): StoredPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const { cameraDeviceId, resolution, gameId, setCode, sessionTags, sound } = parsed as StoredPreferences;
    return {
      cameraDeviceId: typeof cameraDeviceId === "string" ? cameraDeviceId : undefined,
      resolution: isValidSize(resolution) ? resolution : undefined,
      gameId: typeof gameId === "string" ? gameId : undefined,
      setCode: typeof setCode === "string" ? setCode : undefined,
      sessionTags: typeof sessionTags === "string" ? sessionTags : undefined,
      sound: typeof sound === "boolean" ? sound : undefined,
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
