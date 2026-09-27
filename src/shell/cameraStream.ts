import type { Size } from "../core";

/** The hard floor this app requires the camera feed to meet — Full HD or
 * higher (see CAMERA_RESOLUTION_OPTIONS in config.ts). Enforced via a
 * `min` constraint in startCameraStream, not just offered as a preference. */
export const MIN_CAMERA_WIDTH = 1920;
export const MIN_CAMERA_HEIGHT = 1080;

/**
 * Requests camera access and attaches the resulting stream to `video`.
 * Resolves once the video's metadata has loaded (so
 * `video.videoWidth`/`videoHeight` are available) and playback has started.
 *
 * Requests exactly the camera `deviceId` (see listFullHdCameras in
 * cameraDevices.ts for how the caller learns which ids support Full HD).
 *
 * `targetResolution`'s width/height are requested as `ideal` (the caller's
 * preferred size, e.g. from the resolution dropdown — see
 * CAMERA_RESOLUTION_OPTIONS' doc comment in config.ts for why the
 * negotiated size can end up different from what was asked for) but with a
 * hard `min` of 1920×1080: this app requires Full HD or higher, so a
 * camera that can't meet that floor fails acquisition outright (an
 * `OverconstrainedError`, surfaced below with a clear message) rather than
 * silently starting at a lower, unsupported resolution.
 *
 * Throws a descriptive `Error` on permission denial, no camera, a camera
 * that can't meet the Full HD floor, camera already in use, or
 * `getUserMedia` being unsupported at all (see toCameraError).
 */
export async function startCameraStream(
  video: HTMLVideoElement,
  targetResolution: Size,
  deviceId: string,
): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera access (getUserMedia) isn't supported in this browser. Try a recent Chrome or Safari.",
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { min: MIN_CAMERA_WIDTH, ideal: targetResolution.width },
      height: { min: MIN_CAMERA_HEIGHT, ideal: targetResolution.height },
    },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    throw toCameraError(error);
  }

  video.srcObject = stream;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("The camera stream failed to load into the video element."));
  });
  await video.play();
}

/** Stops all tracks on the video's current stream and detaches it. */
export function stopCameraStream(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
  video.srcObject = null;
}

/** A user-facing Error for a `getUserMedia` failure. */
export function toCameraError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return new Error("Camera permission was denied. Allow camera access in your browser settings and reload.");
      case "NotFoundError":
        return new Error("No camera was found on this device.");
      case "OverconstrainedError":
        return new Error(
          `This camera doesn't support Full HD (${MIN_CAMERA_WIDTH}×${MIN_CAMERA_HEIGHT}) or higher, which this app requires.`,
        );
      case "NotReadableError":
        return new Error("The camera is already in use by another application.");
      default:
        return new Error(`Camera error: ${error.message || error.name}`);
    }
  }
  return error instanceof Error ? error : new Error("Unknown camera error.");
}
