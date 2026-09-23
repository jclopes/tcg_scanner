import { MIN_CAMERA_WIDTH, MIN_CAMERA_HEIGHT } from "./cameraStream";

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
 * is left out of the returned list entirely, per the requirement that the
 * dropdown only offer cameras that actually support it. Devices that fail
 * to open for any other reason (e.g. already in use) are also left out
 * rather than failing the whole scan.
 *
 * Requires camera permission to already be granted (or grantable via a
 * prompt) — the caller should expect this to trigger the browser's
 * permission dialog the first time it runs.
 */
export async function listFullHdCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  // A generic permission probe first: until the user has granted camera
  // permission at least once, enumerateDevices() returns video inputs with
  // blank labels and (in some browsers) a single anonymized entry, so
  // per-device probing below wouldn't produce usable labels or distinct
  // ids. Stopped immediately — this stream is only to unlock labels.
  try {
    const probeStream = await navigator.mediaDevices.getUserMedia({ video: true });
    for (const track of probeStream.getTracks()) {
      track.stop();
    }
  } catch {
    return [];
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
  } catch {
    return null;
  }

  try {
    const [track] = stream.getVideoTracks();
    if (!track) {
      return null;
    }
    const capabilities = track.getCapabilities?.();
    const settings = track.getSettings();
    const maxWidth = capabilities?.width?.max ?? settings.width ?? MIN_CAMERA_WIDTH;
    const maxHeight = capabilities?.height?.max ?? settings.height ?? MIN_CAMERA_HEIGHT;
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
