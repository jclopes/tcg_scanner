/** The element with `id`. Throws if index.html has no such element. */
export function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected an element with id="${id}" in index.html.`);
  }
  return el as T;
}

export function optionElement(value: string, label: string): HTMLOptionElement {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

/** An empty-valued option standing in for a list with nothing to pick. */
export function placeholderOption(label: string): HTMLOptionElement {
  return optionElement("", label);
}

/** A palette color from index.html's `:root` (e.g. "--accent"), for canvas
 * drawing. */
export function paletteColor(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) {
    throw new Error(`Expected a palette color ${name} on :root in index.html.`);
  }
  return value;
}
