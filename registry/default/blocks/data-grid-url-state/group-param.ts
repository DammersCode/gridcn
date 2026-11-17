import { MAX_GROUP_LEVELS } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { safeDecode } from "./sort-param";

/** Comma-separated column ids, outermost group first, each percent-encoded (ids may contain `,`). */
export function serializeGroupBy(groupBy: readonly string[]): string {
  return groupBy.map(encodeURIComponent).join(",");
}

/**
 * Inverse of {@link serializeGroupBy}. Reads at most the first 4 raw segments; an empty or
 * undecodable segment and a repeated id drop. Column checks belong to the caller.
 *
 * @example parseGroupBy("region,team") // => ["region", "team"]
 */
export function parseGroupBy(raw: string): string[] {
  const ids: string[] = [];
  for (const segment of raw.split(",", MAX_GROUP_LEVELS)) {
    const id = safeDecode(segment);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
