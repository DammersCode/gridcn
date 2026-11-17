import { gridAttrSelector } from "../data-attributes";

const portaledPointerDowns = new WeakSet<Event>();

/** True when a React handler sees an event from content portaled out of its element (a custom editor popup), whether or not it carries `data-grid-cell-editor`. */
export function isPortaledEvent(event: { currentTarget: Element; target: EventTarget | null }): boolean {
  return event.target instanceof Node && !event.currentTarget.contains(event.target);
}

/** True when a cell handler must leave the event to an editor: portaled out of the cell, or inside a marked editor. */
export function isCellEditorEvent(event: { currentTarget: Element; target: EventTarget | null }): boolean {
  return isPortaledEvent(event) || (event.target instanceof Element && event.target.closest(gridAttrSelector("cellEditor")) !== null);
}

/** Flags a pointerdown that React routed through the grid root from portaled content, for document handlers that run before React. */
export function markPortaledPointerDown(event: { currentTarget: Element; target: EventTarget | null; nativeEvent: Event }): void {
  if (isPortaledEvent(event)) portaledPointerDowns.add(event.nativeEvent);
}

export function wasPortaledPointerDown(event: Event): boolean {
  return portaledPointerDowns.has(event);
}
