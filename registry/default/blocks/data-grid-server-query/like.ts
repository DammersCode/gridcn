/** The ESCAPE character the Drizzle and Kysely renderers declare. */
export const LIKE_ESCAPE = "!";

/** Escapes `%`, `_`, and the escape character, so `text` matches itself inside a LIKE pattern. */
export function escapeLike(text: string, escapeChar: string = LIKE_ESCAPE): string {
  let out = "";
  for (const char of text) out += char === "%" || char === "_" || char === escapeChar ? escapeChar + char : char;
  return out;
}

/** A LIKE pattern that matches `text` by `mode`. */
export function likePattern(mode: "contains" | "startsWith" | "endsWith" | "equals", text: string, escapeChar: string = LIKE_ESCAPE): string {
  const escaped = escapeLike(text, escapeChar);
  if (mode === "contains") return `%${escaped}%`;
  if (mode === "startsWith") return `${escaped}%`;
  if (mode === "endsWith") return `%${escaped}`;
  return escaped;
}
