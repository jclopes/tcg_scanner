import { canvasToObjectURL } from "./canvasUtils";

export interface ResultViewElements {
  /** The thumbnail button; clicking it opens the overlay. */
  thumbnailButton: HTMLButtonElement;
  thumbnail: HTMLImageElement;
  /** Full-screen overlay showing the whole card; clicking anywhere closes it. */
  overlay: HTMLElement;
  overlayImage: HTMLImageElement;
}

/**
 * The captured result: a thumbnail of the collector number's crop, and an
 * overlay with the full flattened card. The card is shown through a `blob:`
 * URL (openable at full resolution), revoked when replaced or cleared.
 */
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

  /** Shows `preview` as the thumbnail and `card` in the overlay: a `data:`
   * URL immediately, then a `blob:` URL. Rejects if encoding fails. */
  async show(card: HTMLCanvasElement, preview: HTMLCanvasElement): Promise<void> {
    this.clear();
    this.elements.thumbnail.src = preview.toDataURL("image/png");
    this.elements.overlayImage.src = card.toDataURL("image/png");
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
    if (this.objectUrl) {
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
