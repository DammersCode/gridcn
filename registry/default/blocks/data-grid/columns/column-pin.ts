import { isDev } from "../is-dev";
import type { ColumnPin } from "../types";
import type { AnyColumnDef } from "../store/types";

const LEGACY_PIN: Record<string, ColumnPin> = { left: "start", right: "end" };
const migratedColumns = new WeakMap<AnyColumnDef, AnyColumnDef>();
let warned = false;

/** Reads a pin from untrusted or persisted input; `"left"` and `"right"` from before the logical rename read as `"start"` and `"end"`. */
export function readColumnPin(value: unknown): ColumnPin | undefined {
  if (value === "start" || value === "end") return value;
  if (typeof value !== "string" || !Object.hasOwn(LEGACY_PIN, value)) return undefined;
  if (isDev() && !warned) {
    warned = true;
    console.warn(`[data-grid] pin: "left" is now "start" and pin: "right" is now "end"; "${value}" is read as "${LEGACY_PIN[value]}"`);
  }
  return LEGACY_PIN[value];
}

/** Returns the column with a legacy `pin` value replaced by its logical name; other columns pass through by identity. */
export function withLogicalPin(column: AnyColumnDef): AnyColumnDef {
  const pin: unknown = column.pin;
  if (pin === undefined || pin === "start" || pin === "end") return column;
  const cached = migratedColumns.get(column);
  if (cached) return cached;
  const migrated = { ...column, pin: readColumnPin(pin) };
  migratedColumns.set(column, migrated);
  return migrated;
}
