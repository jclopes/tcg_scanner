import { MIN_CAMERA_WIDTH, MIN_CAMERA_HEIGHT, toCameraError } from "./cameraStream";

/** One camera device confirmed to support this app's Full HD floor (see
 * MIN_CAMERA_WIDTH/MIN_CAMERA_HEIGHT), with the highest resolution it
 * reported supporting — used to filter which entries of
 * CAMERA_RESOLUTION_OPTIONS (config.ts) are worth offering for this
 * specific camera. */
export interface CameraOption {
  deviceId: string;
  label: string;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Enumerates the device's video input cameras and probes each one to find
 * out which support Full HD (see startCameraStream's `min` constraint) —
 * `enumerateDevices` alone can't answer that; it only lists device ids and
 * (once permission is granted) labels, not capabilities.
 *
 * Probing means briefly opening a stream against each camera with the same
 * Full HD `min` constraint startCameraStream uses, reading back
 * `getCapabilities()` (or, where unsupported, the negotiated
 * `getSettings()` size) for its max resolution, then stopping it — so each
 * candidate camera's indicator light blinks on and off once. This runs
 * once per app load (see app.ts), not on every dropdown open.
 *
 * A device that rejects the Full HD `min` constraint (`OverconstrainedError`)
 * or is already in use (`NotReadableError`) is left out of the returned list.
 * Any other failure — no camera API, permission denied — throws a
 * user-facing Error (see toCameraError).
 *
 * Triggers the browser's permission dialog the first time it runs.
 */
export async function listFullHdCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Camera access (getUserMedia) isn't supported in this browser. Try a recent Chrome or Safari.");
  }

  // A generic permission probe first: until the user has granted camera
  // permission at least once, enumerateDevices() returns video inputs with
  // blank labels and (in some browsers) a single anonymized entry, so
  // per-device probing below wouldn't produce usable labels or distinct
  // ids. Stopped immediately — this stream is only to unlock labels.
  let probeStream: MediaStream;
  try {
    probeStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (error) {
    throw toCameraError(error);
  }
  for (const track of probeStream.getTracks()) {
    track.stop();
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoInputs = devices.filter((device) => device.kind === "videoinput");

  const results: CameraOption[] = [];
  for (const device of videoInputs) {
    const capability = await probeCameraCapability(device.deviceId);
    if (!capability) {
      continue;
    }
    results.push({
      deviceId: device.deviceId,
      label: device.label || `Camera ${results.length + 1}`,
      maxWidth: capability.maxWidth,
      maxHeight: capability.maxHeight,
    });
  }
  return results;
}

/** Errors that just mean "this camera can't be offered", not a failure. */
const SKIPPED_CAMERA_ERRORS = new Set(["OverconstrainedError", "NotReadableError"]);

/** The camera's max resolution, or null if it can't meet the Full HD floor
 * or is in use. */
async function probeCameraCapability(deviceId: string): Promise<{ maxWidth: number; maxHeight: number } | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { min: MIN_CAMERA_WIDTH },
        height: { min: MIN_CAMERA_HEIGHT },
      },
    });
  } catch (error) {
    if (error instanceof DOMException && SKIPPED_CAMERA_ERRORS.has(error.name)) {
      return null;
    }
    throw toCameraError(error);
  }

  try {
    const [track] = stream.getVideoTracks();
    if (!track) {
      throw new Error(`Camera ${deviceId} opened without a video track.`);
    }
    const capabilities = track.getCapabilities?.();
    const settings = track.getSettings();
    const maxWidth = capabilities?.width?.max ?? settings.width;
    const maxHeight = capabilities?.height?.max ?? settings.height;
    if (maxWidth === undefined || maxHeight === undefined) {
      throw new Error(`Camera ${deviceId} reported no resolution.`);
    }
    if (maxWidth < MIN_CAMERA_WIDTH || maxHeight < MIN_CAMERA_HEIGHT) {
      return null;
    }
    return { maxWidth, maxHeight };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
