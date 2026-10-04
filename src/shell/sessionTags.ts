import { parseTags } from "../core";
import type { ParsedTags } from "../core";
import { loadPreferences, savePreferences } from "./preferences";

export interface SessionTagsElements {
  input: HTMLInputElement;
  error: HTMLElement;
}

/** The session-tags input: "#tags" recorded with every card added, saved as a
 * preference; invalid tokens are listed in its error line. */
export class SessionTagsInput {
  private parsedTags: ParsedTags;

  constructor(private readonly elements: SessionTagsElements) {
    elements.input.value = loadPreferences().sessionTags ?? "";
    this.parsedTags = this.readTags();
    elements.input.addEventListener("input", () => this.handleChange());
  }

  /** The session tags, plus any tokens in the input that aren't valid tags. */
  get parsed(): ParsedTags {
    return this.parsedTags;
  }

  /** Parses the input and shows which tokens aren't valid tags. */
  private readTags(): ParsedTags {
    const parsed = parseTags(this.elements.input.value);
    const invalid = parsed.invalid.length > 0;
    this.elements.input.setAttribute("aria-invalid", String(invalid));
    this.elements.error.hidden = !invalid;
    this.elements.error.textContent = invalid ? `Tags must start with # and contain no spaces: ${parsed.invalid.join(" ")}` : "";
    return parsed;
  }

  private handleChange(): void {
    this.parsedTags = this.readTags();
    savePreferences({ sessionTags: this.elements.input.value });
  }
}
