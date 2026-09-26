import type { Orientation, Size } from "../core";

/** A frame's orientation from its own dimensions (not the device's), so a
 * still whose shape differs from the preview gets its own orientation. */
export function orientationFromSize(size: Size): Orientation {
  return size.width > size.height ? "landscape" : "portrait";
}

/** The video's current intrinsic frame size. Throws if it has no frame yet —
 * callers only read frames from a started stream. */
export function videoFrameSize(video: HTMLVideoElement): Size {
  if (video.videoWidth === 0 || video.videoHeight === 0) {
    throw new Error("The camera video has no frame dimensions yet.");
  }
  return { width: video.videoWidth, height: video.videoHeight };
}

/**
 * Calls `onChange` now (if dimensions are known) and whenever the video's
 * intrinsic frame size changes (the element's own "resize"/"loadedmetadata"
 * events, not the window's). Returns an unsubscribe function.
 */
export function watchVideoOrientation(
  video: HTMLVideoElement,
  onChange: (orientation: Orientation, frameSize: Size) => void,
): () => void {
  const handleChange = (): void => {
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    const frameSize = videoFrameSize(video);
    onChange(orientationFromSize(frameSize), frameSize);
  };

  video.addEventListener("loadedmetadata", handleChange);
  video.addEventListener("resize", handleChange);
  handleChange();

  return () => {
    video.removeEventListener("loadedmetadata", handleChange);
    video.removeEventListener("resize", handleChange);
  };
}
