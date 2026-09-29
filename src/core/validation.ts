// Pure field checks for JSON loaded at runtime (bundled game data, saved
// lists). Each throws an Error naming `context` (which file/entry) and the
// field, so bad data fails loudly at load instead of breaking something
// later (e.g. a mistyped "x_mm" silently becoming NaN).

/** `value` as a JSON object's fields. Throws if it isn't a (non-array) object. */
export function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object, got ${describe(value)}.`);
  }
  return value as Record<string, unknown>;
}

/** `value` as a list. Throws if it isn't one. */
export function requireList(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be a list, got ${describe(value)}.`);
  }
  return value;
}

/** `record[key]` as a finite number. */
export function requireNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw fieldError(context, key, "a number", value);
  }
  return value;
}

/** `record[key]` as a finite number, or undefined when absent. */
export function optionalNumber(record: Record<string, unknown>, key: string, context: string): number | undefined {
  return record[key] === undefined ? undefined : requireNumber(record, key, context);
}

/** `record[key]` as a non-empty string. */
export function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw fieldError(context, key, "a non-empty string", value);
  }
  return value;
}

/** `record[key]` as a non-empty string, or undefined when absent. */
export function optionalString(record: Record<string, unknown>, key: string, context: string): string | undefined {
  return record[key] === undefined ? undefined : requireString(record, key, context);
}

/** `record[key]` as a boolean. */
export function requireBoolean(record: Record<string, unknown>, key: string, context: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw fieldError(context, key, "true or false", value);
  }
  return value;
}

/** `record[key]` as a list. */
export function requireArray(record: Record<string, unknown>, key: string, context: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw fieldError(context, key, "a list", value);
  }
  return value;
}

/** `record[key]` as a non-empty list of distinct non-empty strings. */
export function requireStringArray(record: Record<string, unknown>, key: string, context: string): string[] {
  const value = requireArray(record, key, context);
  if (value.length === 0 || !value.every((item) => typeof item === "string" && item !== "")) {
    throw fieldError(context, key, "a non-empty list of non-empty strings", value);
  }
  requireUnique(value as string[], `"${key}"`, context);
  return value as string[];
}

/** Throws if `values` has a repeat, naming the first one. */
export function requireUnique(values: readonly string[], what: string, context: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${context}: ${what} has "${value}" more than once.`);
    }
    seen.add(value);
  }
}

function fieldError(context: string, key: string, expected: string, value: unknown): Error {
  return new Error(`${context}: "${key}" must be ${expected}, got ${describe(value)}.`);
}

function describe(value: unknown): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}
