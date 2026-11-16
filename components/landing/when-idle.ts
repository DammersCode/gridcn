const FALLBACK_DELAY_MS = 200;

/** Runs `callback` in an idle period, or after a short delay where `requestIdleCallback` is missing (Safari). Returns the cancel function. */
export function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(callback);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(callback, FALLBACK_DELAY_MS);
  return () => clearTimeout(id);
}
