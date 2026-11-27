export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

export function labelled(text: string, input: HTMLElement, className = "field"): HTMLLabelElement {
  const l = el("label", { className }, text);
  l.appendChild(input);
  return l;
}

/** Number text for a field: fixed decimals, or trimmed when `trim` is set. */
export function fmt(n: number, digits: number, trim = false): string {
  const s = n.toFixed(digits);
  return trim ? String(+s) : s;
}

/** Skip repainting a field the person is typing in. */
export function isFocused(e: Element): boolean {
  return document.activeElement === e;
}
