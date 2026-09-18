import type { SortSpec } from "@/registry/default/blocks/data-grid/data-grid";

/**
 * Compact URL encoding for {@link SortSpec}[]: comma-separated `columnId:direction` pairs,
 * column id percent-encoded (ids are consumer-controlled and may contain `,`/`:`).
 *
 * @example serializeSortState([{ columnId: "name", direction: "asc" }, { columnId: "age", direction: "desc" }])
 * // => "name:asc,age:desc"
 */
export function serializeSortState(sorts: readonly SortSpec[]): string {
  return sorts.map((s) => `${encodeURIComponent(s.columnId)}:${s.direction}`).join(",");
}

/** `decodeURIComponent` throws on malformed `%` sequences a hand-edited URL can contain — never let that surface. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Inverse of {@link serializeSortState}. Malformed segments (missing direction, bad direction
 * value, empty/undecodable column id) are dropped silently rather than throwing — a corrupt/hand-edited
 * URL degrades to fewer sorts, never an error.
 *
 * @example parseSortState("name:asc,age:desc") // => [{ columnId: "name", direction: "asc" }, { columnId: "age", direction: "desc" }]
 * @example parseSortState("garbage") // => []
 */
export function parseSortState(raw: string): SortSpec[] {
  if (!raw) return [];
  const sorts: SortSpec[] = [];
  for (const segment of raw.split(",")) {
    const [columnId, direction] = segment.split(":");
    if (!columnId || (direction !== "asc" && direction !== "desc")) continue;
    const decoded = safeDecode(columnId);
    if (decoded === null || decoded === "") continue;
    sorts.push({ columnId: decoded, direction });
  }
  return sorts;
}
