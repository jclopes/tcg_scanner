import { PREVIEW_STREAM_SIZE } from "./config";

/**
 * Requests camera access and attaches the resulting stream to `video`,
 * preferring the environment/back camera (`facingMode: "environment"`)
 * since this app scans physical cards, not selfies. Resolves once the
 * video's metadata has loaded (so `video.videoWidth`/`videoHeight` are
 * available) and playback has started.
 *
 * `facingMode` is requested as `ideal`, not `exact` — most laptop/desktop
 * webcams have no "environment" camera at all, and an `exact` constraint
 * would make `getUserMedia` reject outright on those devices instead of
 * just falling back to whatever camera is available (per the plan's
 * "Works with both a phone browser and a desktop/laptop webcam" acceptance
 * criterion).
 *
 * Throws a descriptive `Error` on permission denial, no camera, camera
 * already in use, or `getUserMedia` being unsupported at all — the caller
 * (src/shell/app.ts) is responsible for surfacing this to the user rather
 * than failing silently, per the task's explicit instruction.
 */
export async function startCameraStream(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Camera access (getUserMedia) isn't supported in this browser. Try a recent Chrome or Safari.",
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: PREVIEW_STREAM_SIZE.width },
      height: { ideal: PREVIEW_STREAM_SIZE.height },
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

function toCameraError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return new Error("Camera permission was denied. Allow camera access in your browser settings and reload.");
      case "NotFoundError":
      case "OverconstrainedError":
        return new Error("No camera was found on this device.");
      case "NotReadableError":
        return new Error("The camera is already in use by another application.");
      default:
        return new Error(`Camera error: ${error.message || error.name}`);
    }
  }
  return error instanceof Error ? error : new Error("Unknown camera error.");
}
