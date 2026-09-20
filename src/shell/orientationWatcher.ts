import type { Orientation, Size } from "../core";

/**
 * Derives the camera/frame `Orientation` from a live video element's actual
 * reported frame dimensions (`videoWidth`/`videoHeight`) — width > height
 * means landscape. Deliberately *not* derived from a device/screen
 * orientation API: the plan's guide geometry is tied to the camera frame's
 * own shape, not the device chrome's orientation (a landscape-mounted
 * webcam on a portrait-oriented screen, for instance, should still get a
 * landscape guide).
 */
export function getVideoOrientation(video: HTMLVideoElement): Orientation {
  return video.videoWidth > video.videoHeight ? "landscape" : "portrait";
}

/**
 * Subscribes to changes in the video's reported frame size/orientation,
 * invoking `onChange` once immediately (if dimensions are already known)
 * and again every time they change.
 *
 * Listens to the video element's own "resize" event — which
 * `HTMLVideoElement` fires whenever `videoWidth`/`videoHeight` change
 * intrinsically (e.g. the camera stream switches size after the user
 * rotates a mobile device and the browser renegotiates the stream) — not
 * the unrelated window "resize" event. Also listens to "loadedmetadata"
 * for the initial dimensions once the stream first attaches.
 *
 * `onChange` fires on every dimension change even if the portrait/landscape
 * *category* is unchanged, since guide geometry (computeGuideGeometry) also
 * depends on the concrete frame size, not just the category.
 *
 * Returns an unsubscribe function.
 */
export function watchVideoOrientation(
  video: HTMLVideoElement,
  onChange: (orientation: Orientation, frameSize: Size) => void,
): () => void {
  const handleChange = (): void => {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    onChange(getVideoOrientation(video), { width: video.videoWidth, height: video.videoHeight });
  };

  video.addEventListener("loadedmetadata", handleChange);
  video.addEventListener("resize", handleChange);
  // Fire immediately in case metadata is already loaded by the time this is
  // called (e.g. subscribing after startCameraStream's promise resolves).
  handleChange();

  return () => {
    video.removeEventListener("loadedmetadata", handleChange);
    video.removeEventListener("resize", handleChange);
  };
}
