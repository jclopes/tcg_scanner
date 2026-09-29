import { parseTags } from "../core";
import type { ParsedTags } from "../core";
import { SUGGESTED_SESSION_TAGS } from "./config";
import { loadPreferences, savePreferences } from "./preferences";

export interface SessionTagsElements {
  input: HTMLInputElement;
  /** Where the one-click suggestion chips go. */
  suggestions: HTMLElement;
  error: HTMLElement;
}

/**
 * The session-tags input: space-separated "#tags" recorded with every card
 * added, one-click suggestions (SUGGESTED_SESSION_TAGS), and an error line
 * listing tokens that aren't valid tags. The input's text is saved as a
 * preference and restored on load.
 */
export class SessionTagsInput {
  private parsedTags: ParsedTags;

  constructor(private readonly elements: SessionTagsElements) {
    elements.input.value = loadPreferences().sessionTags ?? "";
    this.parsedTags = this.readTags();
    elements.suggestions.replaceChildren(...SUGGESTED_SESSION_TAGS.map((tag) => this.suggestionButton(tag)));
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

  /** A button that appends `tag` to the input unless it's already there. */
  private suggestionButton(tag: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-suggestion";
    button.textContent = tag;
    button.addEventListener("click", () => {
      if (!this.parsedTags.tags.includes(tag)) {
        this.elements.input.value = `${this.elements.input.value.trim()} ${tag}`.trim();
        this.handleChange();
      }
    });
    return button;
  }
}
