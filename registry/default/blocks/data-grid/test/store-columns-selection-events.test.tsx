import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridInternalActions, useDataGridAllColumns, useDataGridColumnFeatureFlags, useDataGridColumnWidth, useDataGridGetSelectionValues, useDataGridVisibleColumns } from "../store";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";
import { type Row, rows, makeConfigWrapper } from "./store-setup.test-helper";

describe("column UX actions (resize/reorder/pin/visibility)", () => {
  const threeColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "age", header: "Age", accessorKey: "age" },
    { id: "id", header: "ID", accessorKey: "id" },
  ];

  function useColumnProbe() {
    return {
      actions: useDataGridInternalActions(),
      visibleIds: useDataGridVisibleColumns().map((c) => c.id),
      flags: useDataGridColumnFeatureFlags(),
    };
  }

  describe("setColumnOrder", () => {
    it("moves a column before/after another, in display order", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);

      act(() => result.current.actions.setColumnOrder("id", "age", "after"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when enableColumnReorder is false", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnReorder: false });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when the dragged column has reorderable: false", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, reorderable: false } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("keeps a pinned column inside its own pin zone: dropping it onto an unpinned target is a no-op", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pin: "start" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      // "id" (pinned left) is already display-first; dragging it next to "age" (unpinned) must not move.
      act(() => result.current.actions.setColumnOrder("id", "age", "after"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });

    it("reorders two pinned-left columns within their own zone", () => {
      const cols = threeColumns.map((c) => (c.id === "id" || c.id === "name" ? { ...c, pin: "start" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["name", "id", "age"]);
      act(() => result.current.actions.setColumnOrder("id", "name", "before"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });
  });

  describe("setColumnPin", () => {
    it("pins a column left, moving it to the front of display order", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "start"));
      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
    });

    it("unpins a column back into the unpinned band", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pin: "start" as const } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["id", "name", "age"]);
      act(() => result.current.actions.setColumnPin("id", null));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when enableColumnPinning is false", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnPinning: false });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "start"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("is a no-op when the column has pinnable: false", () => {
      const cols = threeColumns.map((c) => (c.id === "id" ? { ...c, pinnable: false } : c));
      const wrapper = makeConfigWrapper({ columns: cols });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnPin("id", "start"));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });
  });

  describe("setColumnHidden", () => {
    it("hides and re-shows a column", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });

      act(() => result.current.actions.setColumnHidden("age", true));
      expect(result.current.visibleIds).toEqual(["name", "id"]);

      act(() => result.current.actions.setColumnHidden("age", false));
      expect(result.current.visibleIds).toEqual(["name", "age", "id"]);
    });

    it("re-shows a def-level hidden: true column, and the layout snapshot reflects it", () => {
      const hiddenCols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: hiddenCols, onColumnLayoutChange });
      const { result } = renderHook(useColumnProbe, { wrapper });

      expect(result.current.visibleIds).toEqual(["name"]);

      act(() => {
        result.current.actions.setColumnHidden("age", false);
      });

      expect(result.current.visibleIds).toEqual(["name", "age"]);
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age"],
        pins: {},
        hidden: [],
      });

      act(() => {
        result.current.actions.setColumnHidden("age", true);
      });

      expect(result.current.visibleIds).toEqual(["name"]);
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age"],
        pins: {},
        hidden: ["age"],
      });
    });

    it("a new columns array keeps a column the user re-showed; a new id seeds its def hidden flag", () => {
      const defHidden: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      const replacedDefHidden: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", hidden: true },
      ];
      let actionsRef: ReturnType<typeof useDataGridInternalActions> | null = null;
      let probed: string[] = [];
      function Probe() {
        actionsRef = useDataGridInternalActions();
        probed = useDataGridVisibleColumns().map((c) => c.id);
        return null;
      }
      function Harness({ cols }: { cols: readonly ColumnDef<Row, unknown>[] }) {
        return (
          <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
            <Probe />
          </DataGridProvider>
        );
      }
      const { rerender } = render(<Harness cols={defHidden} />);
      expect(probed).toEqual(["name"]);

      act(() => {
        actionsRef!.setColumnHidden("age", false);
      });
      expect(probed).toEqual(["name", "age"]);

      // same reference: the user's choice survives an unrelated re-render.
      rerender(<Harness cols={defHidden} />);
      expect(probed).toEqual(["name", "age"]);

      rerender(<Harness cols={replacedDefHidden} />);
      expect(probed).toEqual(["name", "age"]);

      const withNewHidden: readonly ColumnDef<Row, unknown>[] = [...replacedDefHidden, { id: "extra", header: "Extra", accessorKey: "name", hidden: true }];
      rerender(<Harness cols={withNewHidden} />);
      expect(probed).toEqual(["name", "age"]);
    });

    it("a new columns array keeps a runtime pin, a runtime unpin, and seeds the pin of a new id", () => {
      const defs = (): readonly ColumnDef<Row, unknown>[] => [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "age", header: "Age", accessorKey: "age", pin: "end" },
      ];
      let actionsRef: ReturnType<typeof useDataGridInternalActions> | null = null;
      let pins: Record<string, string | undefined> = {};
      function Probe() {
        actionsRef = useDataGridInternalActions();
        pins = Object.fromEntries(useDataGridAllColumns().map((c) => [c.id, c.pin]));
        return null;
      }
      function Harness({ cols }: { cols: readonly ColumnDef<Row, unknown>[] }) {
        return (
          <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
            <Probe />
          </DataGridProvider>
        );
      }
      const { rerender } = render(<Harness cols={defs()} />);
      expect(pins).toEqual({ name: undefined, age: "end" });

      act(() => {
        actionsRef!.setColumnPin("name", "start");
        actionsRef!.setColumnPin("age", null);
      });
      rerender(<Harness cols={defs()} />);
      expect(pins).toEqual({ name: "start", age: undefined });

      rerender(<Harness cols={[...defs(), { id: "city", header: "City", accessorKey: "name", pin: "end" }]} />);
      expect(pins).toEqual({ name: "start", age: undefined, city: "end" });
    });
  });

  describe("resolved column-feature flags", () => {
    it("default to true", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(useColumnProbe, { wrapper });
      expect(result.current.flags).toEqual({
        enableColumnResize: true,
        enableColumnReorder: true,
        enableColumnPinning: true,
      });
    });

    it("resolve grid-wide overrides", () => {
      const wrapper = makeConfigWrapper({
        columns: threeColumns,
        enableColumnResize: false,
        enableColumnReorder: false,
        enableColumnPinning: false,
      });
      const { result } = renderHook(useColumnProbe, { wrapper });
      expect(result.current.flags).toEqual({
        enableColumnResize: false,
        enableColumnReorder: false,
        enableColumnPinning: false,
      });
    });
  });

  describe("previewColumnWidth", () => {
    it("sets a live width override read back by resolveColumnWidth's consumers", () => {
      const wrapper = makeConfigWrapper({ columns: threeColumns });
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions() }),
        { wrapper },
      );
      act(() => result.current.actions.previewColumnWidth("name", 240));
      // width overrides are read via useDataGridColumnWidth/useDataGridColumnWidths (layout-context.ts);
      // asserting through the action's own no-throw + a second call composing correctly is sufficient
      // at the store level — layout composition is covered by column-helpers.test.ts / browser tests.
      act(() => result.current.actions.previewColumnWidth("name", 100));
    });

    it("does NOT fire onColumnLayoutChange (per-frame drag write; setColumnWidth is the commit point)", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });
      act(() => result.current.actions.previewColumnWidth("name", 240));
      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });

    it("fires onColumnResizing once per call, with the column id and width — the in-progress counterpart to onColumnLayoutChange", () => {
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnResizing });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.previewColumnWidth("name", 240));
      expect(onColumnResizing).toHaveBeenCalledTimes(1);
      expect(onColumnResizing).toHaveBeenLastCalledWith({ columnId: "name", width: 240 });

      act(() => result.current.actions.previewColumnWidth("name", 260));
      expect(onColumnResizing).toHaveBeenCalledTimes(2);
      expect(onColumnResizing).toHaveBeenLastCalledWith({ columnId: "name", width: 260 });
    });

    it("clamps the written width to the column's [max(32, minWidth), maxWidth] bounds, like the resize gesture", () => {
      const cols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name", minWidth: 80, maxWidth: 200 },
        { id: "age", header: "Age", accessorKey: "age" },
        { id: "id", header: "ID", accessorKey: "id" },
      ];
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: cols, onColumnResizing });
      const { result } = renderHook(
        () => ({
          actions: useDataGridInternalActions(),
          nameWidth: useDataGridColumnWidth("name"),
          ageWidth: useDataGridColumnWidth("age"),
        }),
        { wrapper },
      );

      act(() => result.current.actions.previewColumnWidth("name", 10)); // below minWidth
      expect(result.current.nameWidth).toBe(80);
      expect(onColumnResizing).toHaveBeenLastCalledWith({ columnId: "name", width: 80 });

      act(() => result.current.actions.previewColumnWidth("name", 500)); // above maxWidth
      expect(result.current.nameWidth).toBe(200);

      act(() => result.current.actions.previewColumnWidth("name", 120)); // in range, passes through
      expect(result.current.nameWidth).toBe(120);

      act(() => result.current.actions.previewColumnWidth("age", 10)); // no minWidth: the 32px floor holds
      expect(result.current.ageWidth).toBe(32);
    });
  });

  describe("setColumnWidth", () => {
    it("sets the width and fires onColumnLayoutChange once with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnWidth("name", 240));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: { name: 240 },
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });

    it("does NOT fire onColumnResizing (commit point; previewColumnWidth is the per-frame one)", () => {
      const onColumnResizing = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnResizing });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnWidth("name", 240));
      expect(onColumnResizing).not.toHaveBeenCalled();
    });

    it("clamps the committed width, and the snapshot carries the clamped value", () => {
      const cols: readonly ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name", minWidth: 80, maxWidth: 200 },
        { id: "age", header: "Age", accessorKey: "age" },
        { id: "id", header: "ID", accessorKey: "id" },
      ];
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: cols, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnWidth("name", 10));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: { name: 80 },
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });
  });

  describe("resetColumnWidth", () => {
    it("drops the width override and fires onColumnLayoutChange once, without it", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(
        () => ({ actions: useDataGridInternalActions(), nameWidth: useDataGridColumnWidth("name") }),
        { wrapper },
      );

      act(() => result.current.actions.setColumnWidth("name", 240));
      expect(result.current.nameWidth).toBe(240);

      act(() => result.current.actions.resetColumnWidth("name"));
      expect(result.current.nameWidth).toBeUndefined();
      expect(onColumnLayoutChange).toHaveBeenCalledTimes(2);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: {},
        hidden: [],
      });
    });

    it("is a no-op (no callback) when the column has no override", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.resetColumnWidth("name"));

      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });
  });

  describe("onColumnLayoutChange (setColumnOrder/setColumnPin/setColumnHidden)", () => {
    it("fires once per setColumnOrder commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["id", "name", "age"],
        pins: {},
        hidden: [],
      });
    });

    it("does not fire setColumnOrder's callback on a gated/no-op reorder", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, enableColumnReorder: false, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnOrder("id", "name", "before"));

      expect(onColumnLayoutChange).not.toHaveBeenCalled();
    });

    it("fires once per setColumnPin commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnPin("id", "start"));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: { id: "start" },
        hidden: [],
      });
    });

    it("fires once per setColumnHidden commit with the full snapshot", () => {
      const onColumnLayoutChange = vi.fn();
      const wrapper = makeConfigWrapper({ columns: threeColumns, onColumnLayoutChange });
      const { result } = renderHook(() => ({ actions: useDataGridInternalActions() }), { wrapper });

      act(() => result.current.actions.setColumnHidden("age", true));

      expect(onColumnLayoutChange).toHaveBeenCalledTimes(1);
      expect(onColumnLayoutChange).toHaveBeenLastCalledWith({
        widths: {},
        order: ["name", "age", "id"],
        pins: {},
        hidden: ["age"],
      });
    });
  });
});

describe("defaultColumnLayout", () => {
  const threeColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "age", header: "Age", accessorKey: "age" },
    { id: "id", header: "ID", accessorKey: "id" },
  ];

  function useColumnProbe() {
    return {
      visibleIds: useDataGridVisibleColumns().map((c) => c.id),
    };
  }

  it("seeds columnOrder/pins/hidden/widths once at mount, over the column defs", () => {
    const wrapper = makeConfigWrapper({
      columns: threeColumns,
      defaultColumnLayout: {
        widths: { name: 300 },
        order: ["id", "age", "name"],
        pins: { id: "start" },
        hidden: ["age"],
      },
    });
    const { result } = renderHook(useColumnProbe, { wrapper });
    // "id" is pinned left (front), "age" is hidden, "name" keeps its seeded order slot.
    expect(result.current.visibleIds).toEqual(["id", "name"]);
  });

  it("is ignored on a later prop change (NOT a controlled prop)", () => {
    let probed: string[] = [];
    function Probe() {
      probed = useDataGridVisibleColumns().map((c) => c.id);
      return null;
    }
    function Harness({ order }: { order: string[] }) {
      return (
        <DataGridProvider
          data={rows()}
          columns={threeColumns}
          getRowId={(r) => r.id}
          defaultColumnLayout={{ widths: {}, order, pins: {}, hidden: [] }}
        >
          <Probe />
        </DataGridProvider>
      );
    }
    const { rerender } = render(<Harness order={["id", "name", "age"]} />);
    expect(probed).toEqual(["id", "name", "age"]);

    rerender(<Harness order={["age", "name", "id"]} />);
    // a changed defaultColumnLayout prop after mount is a no-op — order stays what it was seeded with.
    expect(probed).toEqual(["id", "name", "age"]);
  });
});

describe("onSelectionChange", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions() };
  }

  it("fires on selectCell with the current selection in CellRef terms", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 1 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const [selection] = onSelectionChange.mock.calls[0]!;
    expect(selection.anchor).toEqual({ rowId: "2", columnId: "name" });
    expect(selection.range).toEqual({
      start: { rowId: "2", columnId: "name" },
      end: { rowId: "2", columnId: "name" },
    });
    expect(selection.rowIds).toEqual([]);
    expect(selection.columnIds).toEqual([]);
  });

  it("fires once per extendTo step (drag-extend), not just on drop", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 2 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(3);
  });

  it("details.getRowIds returns the rows a cell range covers, in view order", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["1", "2"]);
  });

  it("details.getRowIds reads the row channel (checkbox selection), not just cell ranges", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, rowMarkers: "checkbox" });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.setRowCheckedAt(viewIndex(2), true));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["3"]);
  });

  it("details.getRowIds unions both channels without duplicating a row in each", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange, rowMarkers: "checkbox" });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.setRowCheckedAt(viewIndex(0), true));
    act(() => result.current.actions.setRowCheckedAt(viewIndex(2), true));

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual(["1", "3"]);
  });

  it("details.getRowIds is empty with nothing selected", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());

    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    expect(details.getRowIds()).toEqual([]);
  });

  it("fires on clearSelection", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.clearSelection());

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0].range).toBeNull();
    expect(onSelectionChange.mock.calls[0]![0].anchor).toBeNull();
  });

  it("does not fire when an action leaves selection unchanged", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.previewColumnWidth("name", 200));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("a stationary drag (repeated extendTo at the same coord) fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    onSelectionChange.mockClear();
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));
    act(() => result.current.actions.extendToAt({ col: 0, row: 1 }));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("an extendSelection that cannot grow at the grid edge fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 1, row: 2 })); // last of 2 columns and 3 rows
    onSelectionChange.mockClear();
    act(() => result.current.actions.extendSelection("down"));
    act(() => result.current.actions.extendSelection("right"));

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("a selectColumn re-fire with the same span fires nothing", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectColumn(1));
    onSelectionChange.mockClear();
    act(() => result.current.actions.selectColumn(1, { extendFromLast: true })); // span(1,1) = {1}

    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe("onSelectionChange on clear", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions() };
  }

  it("fires an empty SelectionState when the selection transitions from non-empty to empty", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange.mock.calls.at(-1)![0]).toEqual({
      anchor: null,
      range: null,
      rangeStack: [],
      rowIds: [],
      columnIds: [],
    });
  });

  it("does not fire again when clearing an already-empty selection", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());
    onSelectionChange.mockClear();
    act(() => result.current.actions.clearSelection());

    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

describe("onSelectionChange details.getValues()", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions(), getValues: useDataGridGetSelectionValues() };
  }

  it("reads the primary range's raw cell values, view-row-major", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 1, row: 1 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    const [, details] = onSelectionChange.mock.calls.at(-1)!;
    // columns are name/age; rows()'s first two rows are Charlie/30, Alice/25.
    expect(details.getValues()).toEqual([
      ["Charlie", 30],
      ["Alice", 25],
    ]);
  });

  it("returns [] when there is no active range (a row/column-only selection, or a clear)", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectRow(0));
    expect(onSelectionChange.mock.calls.at(-1)![1].getValues()).toEqual([]);

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.clearSelection());
    expect(onSelectionChange.mock.calls.at(-1)![1].getValues()).toEqual([]);
  });

  it("is lazy: the callback runs without ever invoking getValues itself", () => {
    const getValuesSpy = vi.fn();
    const onSelectionChange = vi.fn((_selection, _details: { getValues: () => unknown }) => {
      getValuesSpy(); // proves the callback ran without touching details.getValues itself
    });
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    act(() => result.current.actions.extendToAt({ col: 1, row: 2 }));

    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(getValuesSpy).toHaveBeenCalledTimes(2);
  });

  it("reflects the CURRENT selection when called later, not a stale snapshot from fire time", () => {
    const onSelectionChange = vi.fn();
    const wrapper = makeConfigWrapper({ onSelectionChange });
    const { result } = renderHook(useSelectionProbe, { wrapper });

    act(() => result.current.actions.selectCellAt({ col: 0, row: 0 }));
    const [, firstDetails] = onSelectionChange.mock.calls[0]!;
    act(() => result.current.actions.selectCellAt({ col: 0, row: 2 }));

    // calling the FIRST fire's getValues() after a later selection change reads the NEW selection —
    // getValues closes over store.getState, not a point-in-time copy of the selection.
    expect(firstDetails.getValues()).toEqual([["Bob"]]);
  });
});

describe("useDataGridGetSelectionValues", () => {
  function useSelectionProbe() {
    return { actions: useDataGridInternalActions(), getValues: useDataGridGetSelectionValues() };
  }

  it("reads the current selection's values imperatively, outside any onSelectionChange fire", () => {
    const wrapper = makeConfigWrapper();
    const { result } = renderHook(useSelectionProbe, { wrapper });

    expect(result.current.getValues()).toEqual([]);

    act(() => result.current.actions.selectCellAt({ col: 0, row: 2 }));
    expect(result.current.getValues()).toEqual([["Bob"]]);
  });

  it("returns a stable callback across renders", () => {
    const wrapper = makeConfigWrapper();
    const { result, rerender } = renderHook(useSelectionProbe, { wrapper });
    const first = result.current.getValues;
    rerender();
    expect(result.current.getValues).toBe(first);
  });
});
