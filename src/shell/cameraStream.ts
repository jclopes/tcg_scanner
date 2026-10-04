import type { Size } from "../core";
import { MIN_CAMERA_RESOLUTION } from "./config";

/** Opens camera `deviceId` at `targetResolution` if it can (never below
 * MIN_CAMERA_RESOLUTION), shows it in `video` and resolves once it plays.
 * Throws a user-facing Error when the camera can't be used (toCameraError). */
export async function startCameraStream(
  video: HTMLVideoElement,
  targetResolution: Size,
  deviceId: string,
): Promise<void> {
  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      deviceId: { exact: deviceId },
      width: { min: MIN_CAMERA_RESOLUTION.width, ideal: targetResolution.width },
      height: { min: MIN_CAMERA_RESOLUTION.height, ideal: targetResolution.height },
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
          `This camera doesn't support Full HD (${MIN_CAMERA_RESOLUTION.width}×${MIN_CAMERA_RESOLUTION.height}) or higher, which this app requires.`,
        );
      case "NotReadableError":
        return new Error("The camera is already in use by another application.");
      default:
        return new Error(`Camera error: ${error.message === "" ? error.name : error.message}`);
    }
  }
  return error instanceof Error ? error : new Error("Unknown camera error.");
}
