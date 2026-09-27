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

/** Calls `onChange` whenever the video's intrinsic frame size becomes known
 * or changes (the element's own "loadedmetadata"/"resize" events). A size
 * drop to 0×0 means the stream was detached (scan stopped) and is ignored. */
export function watchVideoFrameSize(video: HTMLVideoElement, onChange: (frameSize: Size) => void): void {
  const handleChange = (): void => {
    const detached = video.videoWidth === 0 || video.videoHeight === 0;
    if (!detached) {
      onChange(videoFrameSize(video));
    }
  };
  video.addEventListener("loadedmetadata", handleChange);
  video.addEventListener("resize", handleChange);
}
