import type { PixelRegion } from "../core";

/**
 * Extracts `region` from `source` — a flattened card canvas straight from
 * `captureFlattenedCard` (src/shell/capture.ts), already exactly on-ratio
 * and oversampled by the time it gets here (see FLATTEN_OVERSAMPLE_FACTOR's
 * doc comment, src/core/constants.ts — that used to be a separate
 * normalization step run here, before cropping; it now happens as part of
 * the perspective warp itself, one step earlier and one fewer lossy
 * resample). If `region.rotationDeg` is set, first
 * rotates the *entire* card clockwise by
 * that many degrees to undo the region's printed tilt, then crops
 * `region.rect`'s axis-aligned pixel box out of that rotated card. Returns
 * a plain crop, no rotation step, when `rotationDeg` is `0`/unset.
 *
 * Rotate-then-crop, not crop-then-rotate: cropping the *original* card's
 * axis-aligned box first would have to bound a *tilted* rectangle of actual
 * content (e.g. a collector number printed on a 45°-tilted badge), which
 * necessarily pads the box out to the tilted rectangle's own bounding box —
 * wasted corner space that reads as background noise to Tesseract (this is
 * exactly what produced junk characters like `;001'` before
 * `allowed_chars_regex` filtering, when this was validated manually). By
 * rotating the whole card first, the target content is already upright by
 * the time cropping happens, so `region.rect` can be a *tight* box around
 * just that content, with no tilt-driven padding.
 *
 * This changes what `x_mm`/`y_mm`/`width_mm`/`height_mm` mean for a region
 * with `rotation_deg` set (see RegionConfig's doc comment,
 * src/core/identification.ts): they're coordinates on the card *as it
 * looks after* that rotation is applied, not on the original unrotated
 * flattened output — a config author should rotate a reference card image
 * by the same angle first, then measure the box directly on that rotated
 * image, rather than trying to eyeball a diagonal box on the original.
 *
 * The rotated card's canvas is sized to the full bounding box of the
 * rotated rectangle (necessarily larger than the original for any
 * non-90°-multiple angle — unlike Phase 1's `rotateCanvas` in capture.ts,
 * which only ever handles 90°-multiples and so never needs to grow the
 * canvas), so no corner of the card is ever clipped before cropping. The
 * triangular gaps this leaves (outside the original card but inside its
 * rotated bounding box) are filled white rather than left transparent/
 * black, matching what produced clean OCR results when this was validated
 * manually.
 */
export function cropRegion(source: HTMLCanvasElement, region: PixelRegion): HTMLCanvasElement {
  const rotationDeg = region.rotationDeg ?? 0;
  const rotatedSource = rotationDeg === 0 ? source : rotateCardClockwise(source, rotationDeg);

  const { origin, size } = region.rect;
  const cropWidth = Math.max(1, Math.round(size.width));
  const cropHeight = Math.max(1, Math.round(size.height));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  const cropCtx = require2dContext(cropCanvas, "crop a region", { highQuality: true });
  cropCtx.drawImage(rotatedSource, origin.x, origin.y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return cropCanvas;
}

function rotateCardClockwise(source: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const outputWidth = Math.max(1, Math.round(source.width * cos + source.height * sin));
  const outputHeight = Math.max(1, Math.round(source.width * sin + source.height * cos));

  const rotatedCanvas = document.createElement("canvas");
  rotatedCanvas.width = outputWidth;
  rotatedCanvas.height = outputHeight;
  const rotatedCtx = require2dContext(rotatedCanvas, "rotate the card", { highQuality: true });
  rotatedCtx.fillStyle = "white";
  rotatedCtx.fillRect(0, 0, outputWidth, outputHeight);
  rotatedCtx.translate(outputWidth / 2, outputHeight / 2);
  rotatedCtx.rotate(radians);
  rotatedCtx.drawImage(source, -source.width / 2, -source.height / 2);
  return rotatedCanvas;
}

/**
 * `highQuality` sets `imageSmoothingQuality = "high"` in addition to the
 * (already-default) `imageSmoothingEnabled` — Canvas 2D's own spec default
 * for the *quality* of that smoothing is `"low"`, not `"high"`, a
 * lesser-known gotcha that otherwise silently blurs exactly the
 * `drawImage` calls in this file (rotating and cropping a now-oversampled,
 * tens-of-megapixels card canvas — see FLATTEN_OVERSAMPLE_FACTOR,
 * src/core/constants.ts) that most need real resampling quality: caught
 * from a real capture whose region crop looked visibly blurrier than the
 * flattened card it was cropped from, despite coming from the exact same
 * (sharp) image data.
 */
function require2dContext(
  canvas: HTMLCanvasElement,
  purpose: string,
  options?: { highQuality?: boolean },
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(`Could not get a 2D canvas context to ${purpose}.`);
  }
  if (options?.highQuality) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }
  return ctx;
}
