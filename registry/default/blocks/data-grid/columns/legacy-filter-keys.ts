import { isDev } from "../is-dev";
import type { AnyColumnDef } from "../store/types";

const REPLACEMENTS = { filterOperators: "filter.operators", filterMatch: "filter.match", filterCompare: "filter.compare" } as const;
const warned = new Set<string>();

/** Warns once per key in development when a column still spells a filter member flat; the flat key has no effect. */
export function warnLegacyFilterKeys(column: AnyColumnDef): void {
  if (!isDev()) return;
  for (const [oldKey, replacement] of Object.entries(REPLACEMENTS)) {
    if (!(oldKey in column) || warned.has(oldKey)) continue;
    warned.add(oldKey);
    console.warn(`[data-grid] column "${column.id}": \`${oldKey}\` has no effect; use \`${replacement}\` (\`filter: { ${replacement.slice(7)} }\`)`);
  }
}
