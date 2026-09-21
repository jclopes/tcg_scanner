/**
 * Converts `canvas` to a `blob:` object URL — short and stable regardless of
 * image size, unlike a `data:` URL (`canvas.toDataURL()`), which embeds the
 * entire image as base64 text directly in the URL string. That difference
 * matters beyond just tidiness: a full-resolution capture can produce a
 * data: URL tens of megabytes long, and browsers reliably fail to navigate
 * to one that long — e.g. a right-click "open image in new tab" on an
 * `<img>` whose `src` is such a URL silently does nothing. A `blob:` URL
 * has no such limit, since the actual bytes live in the browser's own blob
 * store, not the URL itself.
 *
 * The trade-off is that a `blob:` URL must be explicitly freed via
 * `URL.revokeObjectURL` once it's no longer needed, or the underlying image
 * data (which can be several MB per image) stays alive for the rest of the
 * page's lifetime — callers are responsible for this (see debugSteps.ts and
 * app.ts for the two places that track and revoke their own).
 *
 * Resolves to `null` if the canvas can't produce a blob — `toBlob`'s own
 * contract allows this, though it isn't expected to actually happen for a
 * same-origin canvas with real pixel content.
 */
export function canvasToObjectURL(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? URL.createObjectURL(blob) : null);
    }, "image/png");
  });
}
