/**
 * Grabs a still photo straight off the active camera track via the
 * ImageCapture API, rather than reading whatever frame is currently
 * painted into a `<video>` element (what the rest of the app's detection
 * pipeline does). `ImageCapture.takePhoto()` can return a photo at the
 * camera's full still-capture resolution — often higher than the video
 * stream's own negotiated preview resolution — which is exactly what the
 * "Capture Debug Frame" button wants: the highest-fidelity look at what
 * the edge detector sees, not a downsampled preview frame.
 *
 * Returns `null` (rather than throwing) whenever a hi-res still isn't
 * available — no active stream, no `ImageCapture` support (e.g. Firefox,
 * or non-Chromium mobile browsers), or `takePhoto()` itself rejecting
 * (some cameras/browsers expose `ImageCapture` but reject `takePhoto()` on
 * certain tracks) — so callers can silently fall back to the existing
 * preview-frame capture instead of failing the debug action outright.
 */
export async function captureHiResStill(video: HTMLVideoElement): Promise<HTMLCanvasElement | null> {
  if (typeof ImageCapture === "undefined") {
    return null;
  }

  const stream = video.srcObject;
  if (!(stream instanceof MediaStream)) {
    return null;
  }
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") {
    return null;
  }

  try {
    const imageCapture = new ImageCapture(track);
    const blob = await imageCapture.takePhoto();
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }
      ctx.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
