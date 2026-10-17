/** Captures the pointer on `element`; returns false when the browser refuses (unknown pointer id, detached element) or lacks the API. */
export function safeSetPointerCapture(element: Element | null | undefined, pointerId: number): boolean {
  if (!element?.setPointerCapture) return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "InvalidStateError")) return false;
    throw error;
  }
}
