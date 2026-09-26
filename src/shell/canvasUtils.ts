import type { Quad, RgbaPixelBuffer, Size } from "../core";

/** The canvas's 2D context. Throws if the browser can't provide one. */
export function require2dContext(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", options);
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context.");
  }
  return ctx;
}

export function createCanvas(size: Size): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas;
}

/** A new canvas holding `source` drawn at `size`. */
export function snapshotSource(source: CanvasImageSource, size: Size): HTMLCanvasElement {
  const canvas = createCanvas(size);
  require2dContext(canvas).drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = createCanvas(imageData);
  require2dContext(canvas).putImageData(imageData, 0, 0);
  return canvas;
}

/** `source` rotated clockwise by `degrees` onto a new canvas (width/height
 * swapped for 90/270). Returns `source` itself for 0. */
export function rotateCanvas(source: HTMLCanvasElement, degrees: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (degrees === 0) {
    return source;
  }
  const swap = degrees === 90 || degrees === 270;
  const output = createCanvas(
    swap ? { width: source.height, height: source.width } : { width: source.width, height: source.height },
  );
  const ctx = require2dContext(output);
  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}

/** The pixels inside `corners`' axis-aligned bounding box (clamped to the
 * canvas) — the card as it appears in the raw frame. */
export function readQuadBoundingBoxPixels(canvas: HTMLCanvasElement, corners: Quad): RgbaPixelBuffer {
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const right = Math.min(canvas.width, Math.ceil(Math.max(...xs)));
  const bottom = Math.min(canvas.height, Math.ceil(Math.max(...ys)));

  const imageData = require2dContext(canvas).getImageData(left, top, right - left, bottom - top);
  return { data: imageData.data, width: imageData.width, height: imageData.height };
}

/**
 * `canvas` as a `blob:` object URL. Unlike a `data:` URL, its length doesn't
 * grow with the image, so browsers can open large captures (e.g. "open image
 * in new tab"). The caller must `URL.revokeObjectURL` it when done.
 */
export function canvasToObjectURL(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(URL.createObjectURL(blob));
      } else {
        reject(new Error("Could not encode canvas as an image blob."));
      }
    }, "image/png");
  });
}

/** Calls `callback` on the video's next frame (`requestVideoFrameCallback`,
 * falling back to `requestAnimationFrame`). Returns a cancel function. */
export function scheduleVideoFrame(video: HTMLVideoElement, callback: () => void): () => void {
  if (typeof video.requestVideoFrameCallback === "function") {
    const handle = video.requestVideoFrameCallback(callback);
    return () => video.cancelVideoFrameCallback(handle);
  }
  const handle = requestAnimationFrame(callback);
  return () => cancelAnimationFrame(handle);
}
