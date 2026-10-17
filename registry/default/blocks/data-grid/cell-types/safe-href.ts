/** The only protocols a cell link may use; a type cannot widen the list. */
const SAFE_HREF_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Bounds the input before parsing, so one huge stored value cannot force a URL parse per cell render. */
const MAX_SAFE_HREF_LENGTH = 2_048;

/**
 * Resolves a candidate link to a safe href, or `null` when it may not be rendered or opened.
 * Only `http:`, `https:`, and `mailto:` survive. The input is parsed with `new URL` without a
 * base, so relative (`//evil`) and scheme-less values fail; `javascript:`, `data:`, `file:`, an
 * over-long input, and a parse failure (NUL-injected schemes) all return `null`. The normalized
 * `url.href` is returned, never the raw text.
 */
export function safeHref(raw: string): string | null {
  if (raw.length > MAX_SAFE_HREF_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!SAFE_HREF_PROTOCOLS.has(url.protocol)) return null;
  return url.href;
}
