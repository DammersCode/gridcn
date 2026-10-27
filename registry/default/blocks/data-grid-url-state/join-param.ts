import type { FilterJoinOperator } from "@/registry/default/blocks/data-grid/data-grid";

/** Reads a legacy `join` URL param. Only exactly `"or"` means `"or"`; an absent, empty, or malformed value is `"and"`. */
export function parseLegacyJoin(raw: string): FilterJoinOperator {
  return raw === "or" ? "or" : "and";
}
