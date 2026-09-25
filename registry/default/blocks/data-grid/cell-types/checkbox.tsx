import { useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { GRID_ATTR } from "../data-attributes";

function CheckboxCell({ value }: CellRenderProps<unknown, boolean>) {
  if (value == null) return null;
  // display-only: the interaction layer toggles via commitCellValue, so the control never receives events
  return (
    <span className="flex size-full items-center justify-center">
      <Checkbox checked={value} tabIndex={-1} className="pointer-events-none" {...{ [GRID_ATTR.checkboxBox]: "" }} />
    </span>
  );
}

/** Checkbox has no edit mode (interaction layer toggles+commits directly via `commitCellValue`); this only guards a stray `startEditing` call by bailing out immediately. */
function CheckboxEditor({ cancel }: CellEditorProps<unknown, boolean>) {
  const committed = useCommitGuard();
  useEffect(() => {
    if (!committed.tryCommit()) return;
    cancel();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Truthy tokens accepted by the checkbox type's `fromText` (paste/import), case-insensitive. */
const CHECKBOX_TRUE_TOKENS = new Set(["true", "1", "yes", "x", "on"]);

/** `checkbox`: fromText accepts a small truthy-token set; clipboard round-trips as "true"/"false". */
export const checkboxCellType: CellType<unknown, boolean, GridCellTypes["checkbox"]["options"]> = {
  Cell: CheckboxCell,
  Editor: CheckboxEditor,
  toText: (value) => (value ? "true" : "false"),
  fromText: (text) => CHECKBOX_TRUE_TOKENS.has(text.trim().toLowerCase()),
  clearValue: () => false,
  isEmpty: (value) => value == null,
  compare: (a, b) => Number(a) - Number(b),
  align: "center",
};
