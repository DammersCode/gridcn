import { createWarnOnce } from "../is-dev";
import type { AnyColumnDef } from "../store/types";

const MEMBERS = { filterOperators: "operators", filterMatch: "match", filterCompare: "compare" } as const;
const migrated = new WeakMap<AnyColumnDef, AnyColumnDef>();
const REPLACEMENTS = { filterOperators: "filter.operators", filterMatch: "filter.match", filterCompare: "filter.compare" } as const;
const warnPageOnce = createWarnOnce();

/** Warns once per key and per `warnOnce` (one per grid) in development when a column still spells a filter member flat; the flat key still works when `filter` lacks that member. */
export function warnLegacyFilterKeys(column: AnyColumnDef, warnOnce: ReturnType<typeof createWarnOnce> = warnPageOnce): void {
  for (const [oldKey, replacement] of Object.entries(REPLACEMENTS)) {
    if (!(oldKey in column)) continue;
    warnOnce(oldKey, `column "${column.id}": \`${oldKey}\` moved to \`${replacement}\` (\`filter: { ${replacement.slice(7)} }\`); the flat key is still read, rename it`);
  }
}

/** Returns the column with flat `filterOperators`, `filterMatch`, and `filterCompare` moved into `filter` where that member is absent; other columns pass through by identity. */
export function withLogicalFilter(column: AnyColumnDef): AnyColumnDef {
  const flat = column as unknown as Record<string, unknown>;
  const legacyKeys = Object.keys(MEMBERS).filter((key) => flat[key] !== undefined);
  if (legacyKeys.length === 0) return column;
  const cached = migrated.get(column);
  if (cached) return cached;
  const filter: Record<string, unknown> = { ...column.filter };
  for (const key of legacyKeys) {
    const member = MEMBERS[key as keyof typeof MEMBERS];
    filter[member] ??= flat[key];
  }
  const next = { ...column, filter } as AnyColumnDef;
  migrated.set(column, next);
  return next;
}
