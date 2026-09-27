import { canvasToObjectURL } from "./canvasUtils";

/** The captured-card `<img>` and the `blob:` URL backing it, revoked when
 * replaced or cleared. */
export class ResultImage {
  private objectUrl: string | null = null;
  /** Bumped on every show/clear so a blob URL that resolves late, for an image
   * no longer shown, is revoked instead of kept. */
  private generation = 0;

  constructor(private readonly img: HTMLImageElement) {}

  /** Shows `canvas` immediately as a `data:` URL, then swaps in a `blob:` URL
   * (openable at full resolution in a new tab). Rejects if encoding fails. */
  async show(canvas: HTMLCanvasElement): Promise<void> {
    this.clear();
    this.img.src = canvas.toDataURL("image/png");
    const generation = this.generation;
    const url = await canvasToObjectURL(canvas);
    if (generation !== this.generation) {
      URL.revokeObjectURL(url);
      return;
    }
    this.objectUrl = url;
    this.img.src = url;
  }

  clear(): void {
    this.generation += 1;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.img.removeAttribute("src");
  }
}
