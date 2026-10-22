import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { toSafeText } from "./safe-text";
import { CellSpan } from "./cell-span";
import { CELL_INPUT_CLASS, useCellEditor } from "../interaction/use-cell-editor";

function TextCell({ value }: CellRenderProps<unknown, string>) {
  return <CellSpan text={toSafeText(value)} />;
}

function TextEditor(props: CellEditorProps<unknown, string>) {
  const { ref, ...bindings } = useCellEditor(props, { toDraft: textCellType.toText, toValue: textCellType.fromText });
  return <Input ref={ref} {...bindings} className={CELL_INPUT_CLASS} />;
}

/** `text`: identity value pipeline — clipboard/paste text is the value verbatim. */
export const textCellType: CellType<unknown, string, GridCellTypes["text"]["options"]> = {
  Cell: TextCell,
  Editor: TextEditor,
  toText: (value) => toSafeText(value),
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value == null || value === "",
  compare: (a, b) => a.localeCompare(b),
  align: "left",
};
