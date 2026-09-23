import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, RowMarkersMode } from "../types";
import { DataGridProvider, useDataGridActions } from "../store";
import { useColumnLayout } from "../layout-context";
import { isReorderMarkerMode, markerContent } from "../rows/marker-width";

type Row = { id: string; a: string; b: string };

function rows(): Row[] {
  return [{ id: "1", a: "x", b: "y" }];
}

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "a", header: "A", accessorKey: "a", width: 100 },
  { id: "b", header: "B", accessorKey: "b", width: 120, pin: "left" },
];
// useColumnLayout's public signature is over the store's internal row-agnostic ColumnDef<unknown, ...>,
// same widening every other internal-hook test in this suite performs at its own call boundary.
const internalColumns = columns as unknown as readonly ColumnDef<unknown, unknown>[];

function wrapperWithMarkers(rowMarkers: RowMarkersMode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} rowMarkers={rowMarkers}>
        {children}
      </DataGridProvider>
    );
  };
}

describe("useColumnLayout marker column integration", () => {
  it("adds no marker track when rowMarkers is 'none'", () => {
    const { result } = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("none") });
    expect(result.current.markerWidth).toBe(0);
    expect(result.current.template).toBe("100px 120px");
    expect(result.current.trackLefts).toEqual([0, 100]);
    expect(result.current.totalWidth).toBe(220);
  });

  it("prepends a 44px marker track for 'number' mode and shifts every data-column offset", () => {
    const { result } = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("number") });
    expect(result.current.markerWidth).toBe(44);
    expect(result.current.template).toBe("44px 100px 120px");
    // data-column track positions shift by the marker width — column 0 ("a") now starts at 44, not 0.
    expect(result.current.trackLefts).toEqual([44, 144]);
    expect(result.current.trackRights).toEqual([144, 264]);
    expect(result.current.totalWidth).toBe(264);
  });

  it("uses a 36px track for 'checkbox', 56px for 'both', and 32px for 'reorder'", () => {
    const checkbox = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("checkbox") });
    expect(checkbox.result.current.markerWidth).toBe(36);

    const both = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("both") });
    expect(both.result.current.markerWidth).toBe(56);

    const reorder = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("reorder") });
    expect(reorder.result.current.markerWidth).toBe(32);
  });

  it("widens the track for the reorder family (grip plus content)", () => {
    const reorderNumber = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("reorder-number") });
    expect(reorderNumber.result.current.markerWidth).toBe(56);

    const reorderCheckbox = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("reorder-checkbox") });
    expect(reorderCheckbox.result.current.markerWidth).toBe(48);

    const reorderBoth = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("reorder-both") });
    expect(reorderBoth.result.current.markerWidth).toBe(64);
  });

  it("shifts pinned-left static offsets by the marker width so the marker always renders before pinned data columns", () => {
    const { result } = renderHook(() => useColumnLayout(internalColumns), { wrapper: wrapperWithMarkers("number") });
    // column "b" (index 1) is pin:"left" — its static offset must start right after the marker (44px),
    // not at 0 (which would render it under/before the marker).
    expect(result.current.leftOffsets[1]).toBe(44);
  });
});

describe("marker mode helpers", () => {
  it("only the reorder family arms the drag-to-reorder gesture", () => {
    for (const mode of ["reorder", "reorder-number", "reorder-checkbox", "reorder-both"] as const) {
      expect(isReorderMarkerMode(mode)).toBe(true);
    }
    for (const mode of ["none", "number", "checkbox", "both"] as const) {
      expect(isReorderMarkerMode(mode)).toBe(false);
    }
  });

  it("the reorder family renders its suffix's content, the plain modes themselves, 'reorder' none", () => {
    expect(markerContent("none")).toBe("none");
    expect(markerContent("number")).toBe("number");
    expect(markerContent("checkbox")).toBe("checkbox");
    expect(markerContent("both")).toBe("both");
    expect(markerContent("reorder")).toBe("none");
    expect(markerContent("reorder-number")).toBe("number");
    expect(markerContent("reorder-checkbox")).toBe("checkbox");
    expect(markerContent("reorder-both")).toBe("both");
  });
});

describe("useColumnLayout flex distribution", () => {
  const flexColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "a", header: "A", accessorKey: "a", width: 100, flex: 1 },
    { id: "b", header: "B", accessorKey: "b", width: 100 },
  ];
  const internalFlexColumns = flexColumns as unknown as readonly ColumnDef<unknown, unknown>[];

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={flexColumns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
  }

  it("grows a flex column to fill positive leftover viewport width", () => {
    const { result } = renderHook(() => useColumnLayout(internalFlexColumns, 400), { wrapper });
    // base total 200, available 400 -> 200 leftover all goes to column "a" (only flex column).
    expect(result.current.widths).toEqual([300, 100]);
    expect(result.current.totalWidth).toBe(400);
  });

  it("stays at base widths when availableWidth is 0 (first render/SSR)", () => {
    const { result } = renderHook(() => useColumnLayout(internalFlexColumns), { wrapper });
    expect(result.current.widths).toEqual([100, 100]);
  });

  it("excludes a flex column from distribution once it has a live width override (manual resize)", () => {
    const { result } = renderHook(
      () => ({ layout: useColumnLayout(internalFlexColumns, 400), actions: useDataGridActions() }),
      { wrapper },
    );
    act(() => {
      result.current.actions.setColumnWidth("a", 150);
    });
    // "a" is now fixed at its override (150), and no longer receives the leftover — "b" stays at
    // its own base width too, since it was never given `flex`.
    expect(result.current.layout.widths).toEqual([150, 100]);
  });
});
