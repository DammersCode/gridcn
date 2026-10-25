import { useEffect } from "react";
import { CheckIcon } from "lucide-react";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { GRID_ATTR } from "../data-attributes";

function CheckboxCell({ value, column }: CellRenderProps<unknown, boolean>) {
  if (value == null) return null;
  // display-only: the interaction layer toggles via commitCellValue, so the box never receives events
  // plain span, not the base-ui control: one mounts per row per window commit, and its state machine and effects cost more than the visual
  return (
    <span className="flex size-full items-center justify-center">
      <span
        role="checkbox"
        aria-checked={value ? "true" : "false"}
        aria-label={column.headerText ?? (typeof column.header === "string" ? column.header : column.id)}
        data-checked={value || undefined}
        className="pointer-events-none flex size-4 shrink-0 items-center justify-center rounded-sm border border-input dark:bg-input/30 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary"
        {...{ [GRID_ATTR.checkboxBox]: "" }}
      >
        {value ? <CheckIcon className="size-3.5" /> : null}
      </span>
    </span>
  );
}

/** `CellType` requires an `Editor`, but `startEditing` skips `activate` types: this one only cancels a session opened directly through the store. */
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
  // the edit gestures toggle in place instead of opening an editor (the type owns the gesture, not the name)
  activate: (value) => !value,
  filter: { valueInput: "boolean" },
};
