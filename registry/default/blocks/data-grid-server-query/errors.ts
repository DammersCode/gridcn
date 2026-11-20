export type QueryErrorCode =
  | "invalid-request"
  | "unknown-column"
  | "unknown-operator"
  | "operator-not-allowed"
  | "invalid-value"
  | "limit-exceeded"
  | "unsupported"
  | "unsupported-value"
  | "offset-too-deep"
  | "bad-cursor"
  | "payload-too-large";

/** Thrown for a request the query layer refuses. `path` holds field names and indices, never request text. */
export class QueryError extends Error {
  readonly code: QueryErrorCode;
  readonly path: readonly (string | number)[];
  constructor(code: QueryErrorCode, path: readonly (string | number)[] = []) {
    super(`${code}${path.length > 0 ? ` at ${path.join(".")}` : ""}`);
    this.name = "QueryError";
    this.code = code;
    this.path = path;
  }
}

/** The HTTP status `handleGridRequest` answers for `code`. */
export function statusForCode(code: QueryErrorCode): number {
  if (code === "unsupported") return 501;
  if (code === "payload-too-large") return 413;
  return 400;
}
