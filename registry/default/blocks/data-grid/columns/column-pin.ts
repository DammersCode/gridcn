import { createWarnOnce } from "../is-dev";
import type { ColumnPin } from "../types";
import type { AnyColumnDef } from "../store/types";

type WarnOnce = ReturnType<typeof createWarnOnce>;

const LEGACY_PIN: Record<string, ColumnPin> = { left: "start", right: "end" };
const migratedColumns = new WeakMap<AnyColumnDef, AnyColumnDef>();
const warnPageOnce = createWarnOnce();

/** Reads a pin from untrusted or persisted input; `"left"` and `"right"` from before the logical rename read as `"start"` and `"end"`. A grid passes its own `warnOnce` so that each grid warns once. */
export function readColumnPin(value: unknown, warnOnce: WarnOnce = warnPageOnce): ColumnPin | undefined {
  if (value === "start" || value === "end") return value;
  if (typeof value !== "string" || !Object.hasOwn(LEGACY_PIN, value)) return undefined;
  warnOnce("legacy pin", `pin: "left" is now "start" and pin: "right" is now "end"; "${value}" is read as "${LEGACY_PIN[value]}"`);
  return LEGACY_PIN[value];
}

/** Returns the column with a legacy `pin` value replaced by its logical name; other columns pass through by identity. */
export function withLogicalPin(column: AnyColumnDef, warnOnce: WarnOnce = warnPageOnce): AnyColumnDef {
  const pin: unknown = column.pin;
  if (pin === undefined || pin === "start" || pin === "end") return column;
  const logicalPin = readColumnPin(pin, warnOnce);
  const cached = migratedColumns.get(column);
  if (cached) return cached;
  const migrated = { ...column, pin: logicalPin };
  migratedColumns.set(column, migrated);
  return migrated;
}
