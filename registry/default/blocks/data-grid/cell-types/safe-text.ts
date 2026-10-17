/** `String(value ?? "")` that falls back to `""` when the conversion throws (null-prototype objects, deeply nested arrays). */
export function toSafeText(value: unknown): string {
  if (value == null) return "";
  try {
    return String(value);
  } catch {
    return "";
  }
}
