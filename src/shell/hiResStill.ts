import { snapshotSource } from "./canvasUtils";

/** A still via `ImageCapture.takePhoto()`, which can exceed the preview's
 * resolution; null when the browser has no `ImageCapture`. */
export async function captureHiResStill(video: HTMLVideoElement): Promise<HTMLCanvasElement | null> {
  if (typeof ImageCapture === "undefined") {
    return null;
  }
  const stream = video.srcObject;
  const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
  if (!track || track.readyState !== "live") {
    throw new Error("Hi-res capture needs a live camera track.");
  }

  const blob = await new ImageCapture(track).takePhoto();

  const bitmap = await createImageBitmap(blob);
  try {
    return snapshotSource(bitmap, { width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
}
