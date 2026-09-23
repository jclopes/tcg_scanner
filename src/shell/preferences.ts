import type { Size } from "../core";

/** The user's remembered camera/resolution choices, persisted across
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
    const { cameraDeviceId, resolution } = parsed as StoredPreferences;
    return {
      cameraDeviceId: typeof cameraDeviceId === "string" ? cameraDeviceId : undefined,
      resolution: isValidSize(resolution) ? resolution : undefined,
    };
  } catch {
    return {};
  }
}

export function savePreferences(preferences: StoredPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
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
