import { gridAttrSelector } from "../data-attributes";

const GRID_ROOT_SELECTOR = `[role="grid"]${gridAttrSelector("instance")}`;

/** The innermost grid root around `node`, crossing shadow roots, so a nested grid's elements never count as its host's. */
export function closestGridRoot(node: Node | null): Element | null {
  let element = node instanceof Element ? node : (node?.parentElement ?? null);
  while (element) {
    const found = element.closest(GRID_ROOT_SELECTOR);
    if (found) return found;
    const root = element.getRootNode();
    element = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
}
