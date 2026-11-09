import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "../../store/create-store";
import { cellErrorKey } from "../../store/compute";
import type { InternalSyncProps } from "../../store/types";
import type { DataChange } from "../../types";
import { invertChange } from "../../interaction/history";
import { isBulkBatchCurrent, reresolveBulkWrites, type BulkGeneration } from "../bulk-generation";
import { resolveBulkWrites } from "../validate-batch";
import { pasteText } from "../../clipboard/use-grid-clipboard";
import { buildFillCandidatesFromText } from "../../../data-grid-fill/use-fill-handle";
import { buildImportedRows } from "../../../data-grid-io/build-imported-rows";

type Row = { id: string; hard: string; soft: string };

const tooLong = (v: unknown) => (typeof v === "string" && v.length > 3 ? "Too long" : null);
const columns = [
  { id: "hard", header: "Hard", accessorKey: "hard", validate: tooLong },
  { id: "soft", header: "Soft", accessorKey: "soft", validate: tooLong, validationMode: "warn" },
];
const makeRows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, hard: "ok", soft: "ok" }));

function mount(n = 3, overrides: Partial<InternalSyncProps> = {}) {
  const props = { data: makeRows(n), columns, getRowId: (row: unknown) => (row as Row).id, ...overrides } as InternalSyncProps;
  const store = createDataGridStore(props);
  let generation = 0;
  const guard: BulkGeneration = {
    begin: () => ++generation,
    isCurrent: (token, s, snapshot) => generation === token && isBulkBatchCurrent(s, snapshot),
    reresolve: reresolveBulkWrites,
  };
  const rowsNow = () => store.getState().data as Row[];
  return { store, rowsNow, paste: (text: string) => pasteText(store.getState(), store.getState().actions, text, guard, store) };
}

describe("validationMode warn in bulk writes", () => {
  it("paste: a warn column keeps and flags the invalid value, a block column drops it", () => {
    const { store, rowsNow, paste } = mount();
    store.getState().actions.selectCellAt({ col: 0, row: 0 });
    paste("toolong\ttoolong\nab\tab");
    expect(rowsNow()[0]).toMatchObject({ hard: "ok", soft: "toolong" });
    expect(rowsNow()[1]).toMatchObject({ hard: "ab", soft: "ab" });
    const errors = store.getState().cellErrors;
    expect([...errors.keys()]).toEqual([cellErrorKey("r0", "soft")]);
    expect(errors.get(cellErrorKey("r0", "soft"))).toBe("Too long");
  });

  it("paste: onValidationError reports only the blocked cells", () => {
    const onValidationError = vi.fn();
    const { store, paste } = mount(3, { onValidationError });
    store.getState().actions.selectCellAt({ col: 0, row: 0 });
    paste("toolong\ttoolong");
    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(onValidationError.mock.calls[0]![0].rejected.map((r: { columnId: string }) => r.columnId)).toEqual(["hard"]);
  });

  it("paste: a valid value on a flagged cell clears its flag", () => {
    const { store, paste } = mount();
    store.getState().actions.selectCellAt({ col: 1, row: 0 });
    paste("toolong");
    expect(store.getState().cellErrors.size).toBe(1);
    paste("ab");
    expect(store.getState().cellErrors.size).toBe(0);
  });

  it("undo of the bulk write clears the flags it introduced", () => {
    const changes: DataChange<unknown>[] = [];
    const { store, rowsNow, paste } = mount(3, { onDataChange: (_next: unknown, change: DataChange<unknown>) => void changes.push(change) } as Partial<InternalSyncProps>);
    store.getState().actions.selectCellAt({ col: 1, row: 0 });
    paste("toolong\nlonger!");
    expect(store.getState().cellErrors.size).toBe(2);
    store.getState().actions.commitChange(invertChange(changes[0]!));
    expect(store.getState().cellErrors.size).toBe(0);
    expect(rowsNow().map((r) => r.soft)).toEqual(["ok", "ok", "ok"]);
  });

  it("redo of a bulk write re-flags the warn cells it writes", () => {
    const changes: DataChange<unknown>[] = [];
    const { store, paste } = mount(3, { onDataChange: (_next: unknown, change: DataChange<unknown>) => void changes.push(change) } as Partial<InternalSyncProps>);
    store.getState().actions.selectCellAt({ col: 1, row: 0 });
    paste("toolong\nab");
    const original = changes[0]!;
    store.getState().actions.commitChange(invertChange(original));
    expect(store.getState().cellErrors.size).toBe(0);
    store.getState().actions.commitChange({ ...original, source: "history" });
    expect([...store.getState().cellErrors.keys()]).toEqual([cellErrorKey("r0", "soft")]);
  });

  it("updateCells: a no-op patch on a warn column flags nothing", () => {
    const { store } = mount(3, { data: [{ id: "r0", hard: "ok", soft: "toolong" }] } as Partial<InternalSyncProps>);
    store.getState().actions.updateCells([{ rowId: "r0", columnId: "soft", value: "toolong" }], { source: "stream" });
    expect(store.getState().cellErrors.size).toBe(0);
  });

  it("updateCells: an async schema flags only the cells that were written", async () => {
    const schema = {
      "~standard": { version: 1, vendor: "t", validate: async (v: unknown) => (String(v).length > 3 ? { issues: [{ message: "Too long" }] } : { value: v }) },
    };
    const { store, rowsNow } = mount(3, { columns: [{ id: "soft", header: "Soft", accessorKey: "soft", validate: schema, validationMode: "warn" }] } as never);
    const verdict = store.getState().actions.updateCells(
      [
        { rowId: "r0", columnId: "soft", value: "toolong" },
        { rowId: "r1", columnId: "soft", value: "ok" },
        { rowId: "r2", columnId: "soft", value: "longer!" },
        { rowId: "r2", columnId: "soft", value: "ok" },
      ],
      { source: "stream" },
    );
    await verdict.settled;
    expect(rowsNow().map((r) => r.soft)).toEqual(["toolong", "ok", "ok"]);
    expect([...store.getState().cellErrors.keys()]).toEqual([cellErrorKey("r0", "soft")]);
  });

  it("500-cell paste: one data write, one cellErrors write, no per-cell callbacks", () => {
    const onDataChange = vi.fn();
    const onValidationError = vi.fn();
    const { store, rowsNow, paste } = mount(500, { onDataChange, onValidationError } as Partial<InternalSyncProps>);
    store.getState().actions.selectCellAt({ col: 1, row: 0 });
    const writes = vi.fn();
    store.subscribe(writes);
    paste(Array.from({ length: 500 }, () => "toolong").join("\n"));
    expect(rowsNow().every((r) => r.soft === "toolong")).toBe(true);
    expect(store.getState().cellErrors.size).toBe(500);
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onValidationError).not.toHaveBeenCalled();
    const cellErrorWrites = writes.mock.calls.filter(([next, prev]) => next.cellErrors !== prev.cellErrors).length;
    expect(cellErrorWrites).toBe(1);
  });

  it("updateCells: a warn column commits and flags, a block column is skipped as invalid", () => {
    const { store, rowsNow } = mount();
    const verdict = store.getState().actions.updateCells(
      [
        { rowId: "r0", columnId: "soft", value: "toolong" },
        { rowId: "r1", columnId: "hard", value: "toolong" },
      ],
      { source: "stream" },
    );
    expect(verdict).toMatchObject({ applied: 1, skipped: [{ patchIndex: 1, reason: "invalid" }] });
    expect(rowsNow()[0]!.soft).toBe("toolong");
    expect(rowsNow()[1]!.hard).toBe("ok");
    expect([...store.getState().cellErrors.keys()]).toEqual([cellErrorKey("r0", "soft")]);
  });

  it("updateCells: an async schema on a warn column also commits and flags", async () => {
    const schema = {
      "~standard": { version: 1, vendor: "t", validate: async (v: unknown) => (String(v).length > 3 ? { issues: [{ message: "Too long" }] } : { value: v }) },
    };
    const { store, rowsNow } = mount(3, { columns: [{ id: "soft", header: "Soft", accessorKey: "soft", validate: schema, validationMode: "warn" }] } as never);
    const verdict = store.getState().actions.updateCells([{ rowId: "r0", columnId: "soft", value: "toolong" }], { source: "stream" });
    await verdict.settled;
    expect(rowsNow()[0]!.soft).toBe("toolong");
    expect(store.getState().cellErrors.get(cellErrorKey("r0", "soft"))).toBe("Too long");
  });

  it("fill: the resolution keeps warn cells and reports them as warnings", () => {
    const { store } = mount();
    const s = store.getState();
    const candidates = buildFillCandidatesFromText(s, { x: 0, y: 0, width: 2, height: 1 }, [["toolong", "toolong"]]);
    const resolution = resolveBulkWrites(candidates);
    if (resolution instanceof Promise) throw new Error("expected sync");
    expect(resolution.writes.map((w) => w.columnId)).toEqual(["soft"]);
    expect(resolution.rejected.map((r) => r.columnId)).toEqual(["hard"]);
    s.actions.applyCellUpdates(resolution.writes, "fill", resolution.rejected, resolution.warnings);
    expect([...store.getState().cellErrors.keys()]).toEqual([cellErrorKey("r0", "soft")]);
  });

  it("import: a warn column keeps the value and lists the cell in flagged; a block column is cleared and rejected", () => {
    const textCellType = { Cell: () => null, Editor: () => null, toText: (v: unknown) => String(v ?? ""), fromText: (t: string) => t, clearValue: () => "", isEmpty: (v: unknown) => v === "" };
    const result = buildImportedRows<Row>({
      dataRows: [["toolong", "toolong"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "hard" },
        { importColumnIndex: 1, gridColumnId: "soft" },
      ],
      columns: columns as never,
      cellTypes: { text: textCellType } as never,
      createRow: (index) => ({ id: `n${index}`, hard: "", soft: "" }),
    });
    if (result instanceof Promise) throw new Error("expected sync");
    expect(result.rows[0]).toMatchObject({ hard: "", soft: "toolong" });
    expect(result.rejected.map((c) => c.gridColumnId)).toEqual(["hard"]);
    expect(result.flagged.map((c) => c.gridColumnId)).toEqual(["soft"]);
  });
});
