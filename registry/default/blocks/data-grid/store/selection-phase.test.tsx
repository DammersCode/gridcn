import { act, renderHook } from "@testing-library/react";
import type { PointerEvent, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";
import { DataGridProvider, type SelectionChangeDetails, type SelectionState } from "../data-grid";
import { DEFAULT_KEYMAP } from "../keyboard";
import { useGridInteraction } from "../interaction/use-grid-interaction";
import type { InteractionLayout } from "../data-grid-sdk";

type Row = { id: string; name: string };
const columns = [{ id: "name", header: "Name", accessorKey: "name" as const }];
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];

describe("onSelectionChange details.phase", () => {
  it('reports "end" for the press, "drag" for the steps after it, and one "end" with the settled selection on release', () => {
    const onSelectionChange = vi.fn<(next: SelectionState, details: SelectionChangeDetails) => void>();
    const store = createDataGridStore({ data: rows, columns, getRowId: (row: unknown) => (row as Row).id, onSelectionChange } as unknown as InternalSyncProps);
    const unsubscribe = getInternalActions(store)._subscribeSelection();
    const internal = getInternalActions(store);
    internal._setSelectionPress(true);
    store.getState().actions.selectCellAt({ col: 0, row: 0 });
    store.getState().actions.extendToAt({ col: 0, row: 2 });
    internal._setSelectionPress(false);
    expect(onSelectionChange.mock.calls.map(([, details]) => details.phase)).toEqual(["end", "drag", "end"]);
    expect(onSelectionChange.mock.calls[2]![0]).toEqual(onSelectionChange.mock.calls[1]![0]);

    onSelectionChange.mockClear();
    store.getState().actions.selectCellAt({ col: 0, row: 1 });
    expect(onSelectionChange.mock.calls.map(([, details]) => details.phase)).toEqual(["end"]);
    internal._setSelectionPress(true);
    internal._setSelectionPress(false);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('a mouse click on a cell reports one "end", and nothing more on pointerup', () => {
    const phases: string[] = [];
    const scrollElement = document.createElement("div");
    document.body.appendChild(scrollElement);
    const layout: InteractionLayout = { trackLefts: [0], trackRights: [150], rowHeight: 36, dataRowTop: 36, pinnedBottomHeight: 0, pinnedLeftWidth: 0, pinnedRightWidth: 0, pins: [undefined] };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} onSelectionChange={(_, details) => phases.push(details.phase)}>
        {children}
      </DataGridProvider>
    );
    const { result } = renderHook(() => useGridInteraction({ scrollRef: { current: scrollElement }, layout, keymap: DEFAULT_KEYMAP }), { wrapper });
    const cell = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), querySelector: () => null } as unknown as HTMLElement;
    act(() => result.current.onCellPointerDown({ col: 0, row: 1 }, { button: 0, pointerId: 1, pointerType: "mouse", currentTarget: cell, target: null, clientX: 10, clientY: 80 } as unknown as PointerEvent<HTMLElement>));
    expect(phases).toEqual(["end"]);
    act(() => void document.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1, clientX: 10, clientY: 80 })));
    expect(phases).toEqual(["end"]);
    scrollElement.remove();
  });
});
