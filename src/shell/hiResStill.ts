import { snapshotSource } from "./canvasUtils";

/**
 * A still photo from the camera track via `ImageCapture.takePhoto()`, which
 * can exceed the preview stream's resolution. `null` when that isn't
 * available: no `ImageCapture` support, no live track, or `takePhoto()`
 * rejecting (some browsers expose the API but refuse on certain tracks).
 */
export async function captureHiResStill(video: HTMLVideoElement): Promise<HTMLCanvasElement | null> {
  if (typeof ImageCapture === "undefined") {
    return null;
  }
  const stream = video.srcObject;
  const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
  if (!track || track.readyState !== "live") {
    return null;
  }

  let blob: Blob;
  try {
    blob = await new ImageCapture(track).takePhoto();
  } catch {
    return null;
  }

  const bitmap = await createImageBitmap(blob);
  try {
    return snapshotSource(bitmap, { width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
}
