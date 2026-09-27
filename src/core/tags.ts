// Pure parsing of the session-tags input.

export interface ParsedTags {
  /** Valid tags in input order, without duplicates. */
  tags: string[];
  /** Tokens that aren't a valid tag, in input order. */
  invalid: string[];
}

/** A tag is "#" followed by one or more characters that are neither
 * whitespace nor "#", e.g. "#box-01". */
const TAG_PATTERN = /^#[^\s#]+$/;

/** Splits `input` on whitespace into tags (see TAG_PATTERN) and invalid
 * tokens. */
export function parseTags(input: string): ParsedTags {
  const tokens = input.split(/\s+/).filter((token) => token !== "");
  return {
    tags: [...new Set(tokens.filter((token) => TAG_PATTERN.test(token)))],
    invalid: tokens.filter((token) => !TAG_PATTERN.test(token)),
  };
}
