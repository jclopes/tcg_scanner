import { toCameraError } from "./cameraStream";
import { MIN_CAMERA_RESOLUTION } from "./config";

/** A camera that reaches MIN_CAMERA_RESOLUTION, with the highest resolution
 * it reports. */
export interface CameraOption {
  deviceId: string;
  label: string;
  maxWidth: number;
  maxHeight: number;
}

/**
 * The cameras that reach MIN_CAMERA_RESOLUTION, found by briefly opening each
 * one (its light blinks once), since `enumerateDevices` lists cameras but not
 * their capabilities. Cameras below it or in use are left out; any other
 * failure throws a user-facing Error. Asks for camera permission first.
 */
export async function listFullHdCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    throw new Error("Camera access (getUserMedia) isn't supported in this browser. Try a recent Chrome or Safari.");
  }

  // Until camera permission is granted, enumerateDevices returns blank labels
  // (and in some browsers one anonymized device), so ask first.
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
      label: device.label === "" ? `Camera ${results.length + 1}` : device.label,
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
        width: { min: MIN_CAMERA_RESOLUTION.width },
        height: { min: MIN_CAMERA_RESOLUTION.height },
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
    if (maxWidth < MIN_CAMERA_RESOLUTION.width || maxHeight < MIN_CAMERA_RESOLUTION.height) {
      return null;
    }
    return { maxWidth, maxHeight };
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
