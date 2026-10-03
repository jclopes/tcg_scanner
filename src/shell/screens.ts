export type ScreenName = "scan" | "game" | "settings";

export interface ScreenElements {
  screens: Record<ScreenName, HTMLElement>;
  /** The tab bar's item for each screen. */
  tabs: Record<ScreenName, HTMLButtonElement>;
}

/** Shows one screen at a time, switched with the bottom tab bar. */
export class ScreenNavigator {
  private current: ScreenName;

  /** `onNavigate` runs after every switch to a different screen, with the
   * screen that was left. */
  constructor(
    private readonly elements: ScreenElements,
    initial: ScreenName,
    private readonly onNavigate: (from: ScreenName) => void,
  ) {
    this.current = initial;
    this.render();

    for (const [screen, tab] of Object.entries(elements.tabs) as [ScreenName, HTMLButtonElement][]) {
      tab.addEventListener("click", () => this.show(screen));
    }
  }

  /** Disables or re-enables switching screens with the tab bar. */
  setEnabled(enabled: boolean): void {
    for (const tab of Object.values(this.elements.tabs)) {
      tab.disabled = !enabled;
    }
  }

  private show(screen: ScreenName): void {
    if (screen === this.current) {
      return;
    }
    const from = this.current;
    this.current = screen;
    this.render();
    window.scrollTo(0, 0);
    this.onNavigate(from);
  }

  private render(): void {
    for (const [screen, element] of Object.entries(this.elements.screens) as [ScreenName, HTMLElement][]) {
      element.hidden = screen !== this.current;
    }
    for (const [screen, tab] of Object.entries(this.elements.tabs) as [ScreenName, HTMLButtonElement][]) {
      if (screen === this.current) {
        tab.setAttribute("aria-current", "page");
      } else {
        tab.removeAttribute("aria-current");
      }
    }
  }
}
