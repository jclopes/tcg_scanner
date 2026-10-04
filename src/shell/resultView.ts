import { canvasToObjectURL } from "./canvasUtils";

export interface ResultViewElements {
  /** The thumbnail button — shown only while there's a result; clicking it
   * opens the overlay. */
  thumbnailButton: HTMLButtonElement;
  thumbnail: HTMLImageElement;
  /** Full-screen overlay showing the whole card; clicking anywhere closes it. */
  overlay: HTMLElement;
  overlayImage: HTMLImageElement;
}

/** The captured result: the collector number's crop as a thumbnail, and the
 * full card in an overlay through a `blob:` URL, revoked when replaced. */
export class ResultView {
  private objectUrl: string | null = null;
  /** Bumped on every show/clear so a blob URL that resolves late, for an image
   * no longer shown, is revoked instead of kept. */
  private generation = 0;

  constructor(private readonly elements: ResultViewElements) {
    elements.thumbnailButton.addEventListener("click", () => this.setOverlayOpen(true));
    elements.overlay.addEventListener("click", () => this.setOverlayOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.setOverlayOpen(false);
      }
    });
  }

  /** Shows `preview` (small) as the thumbnail right away, and `card` in the
   * overlay once it's encoded — asynchronously, off the critical path; the
   * overlay only opens on a later tap. Rejects if encoding fails. */
  async show(card: HTMLCanvasElement, preview: HTMLCanvasElement): Promise<void> {
    this.clear();
    this.elements.thumbnail.src = preview.toDataURL("image/png");
    this.elements.thumbnailButton.hidden = false;
    const generation = this.generation;
    const url = await canvasToObjectURL(card);
    if (generation !== this.generation) {
      URL.revokeObjectURL(url);
      return;
    }
    this.objectUrl = url;
    this.elements.overlayImage.src = url;
  }

  clear(): void {
    this.generation += 1;
    this.setOverlayOpen(false);
    this.elements.thumbnailButton.hidden = true;
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.elements.thumbnail.removeAttribute("src");
    this.elements.overlayImage.removeAttribute("src");
  }

  private setOverlayOpen(open: boolean): void {
    this.elements.overlay.hidden = !open;
  }
}
