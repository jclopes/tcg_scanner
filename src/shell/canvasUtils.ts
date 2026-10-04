import type { GrayscalePixels, RgbaPixelBuffer, Size } from "../core";

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

/** A new canvas showing `pixels`. */
export function pixelsToCanvas(pixels: RgbaPixelBuffer): HTMLCanvasElement {
  const canvas = createCanvas(pixels);
  require2dContext(canvas).putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  return canvas;
}

/** A new canvas showing the grayscale `pixels`. */
export function grayscaleToCanvas(pixels: GrayscalePixels): HTMLCanvasElement {
  const rgba = new Uint8ClampedArray(pixels.width * pixels.height * 4);
  for (let i = 0; i < pixels.data.length; i++) {
    const value = pixels.data[i]!;
    rgba[i * 4] = value;
    rgba[i * 4 + 1] = value;
    rgba[i * 4 + 2] = value;
    rgba[i * 4 + 3] = 255;
  }
  return pixelsToCanvas({ data: rgba, width: pixels.width, height: pixels.height });
}

/** The canvas's pixels. */
export function canvasPixels(canvas: HTMLCanvasElement): ImageData {
  return require2dContext(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

/** `source` rotated clockwise by `degrees` onto a new canvas. Returns
 * `source` itself for 0. */
export function rotateCanvas(source: HTMLCanvasElement, degrees: 0 | 90): HTMLCanvasElement {
  if (degrees === 0) {
    return source;
  }
  const output = createCanvas({ width: source.height, height: source.width });
  const ctx = require2dContext(output);
  ctx.translate(output.width / 2, output.height / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}

/** `canvas` as a `blob:` URL, which unlike a `data:` URL stays openable for
 * large images. The caller must revoke it. */
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
