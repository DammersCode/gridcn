import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ColumnDef } from "./types";
import { DataGridOverlays, splitRectByPinZones, type OverlayPlugin, type PinTrackData } from "./overlays";
import { GRID_LAYER } from "./layers";
import { DataGridProvider, useDataGridActions } from "./store";
import { gridAttrSelector } from "./data-attributes";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "a", header: "A", accessorKey: "name" },
  { id: "b", header: "B", accessorKey: "name" },
  { id: "c", header: "C", accessorKey: "name" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Row ${i}` }));
}

/** Renders DataGridOverlays inside a real provider, exposing the actions object via a ref-like callback so tests can drive selection and then assert on the same store instance's overlay output. */
function Harness(props: {
  windowStart: number;
  rowCount: number;
  colCount: number;
  pinTrack?: PinTrackData;
  onActions: (actions: ReturnType<typeof useDataGridActions>) => void;
}) {
  const actions = useDataGridActions();
  props.onActions(actions);
  return (
    <DataGridOverlays
      windowStart={props.windowStart}
      rowCount={props.rowCount}
      colCount={props.colCount}
      pinTrack={props.pinTrack}
    />
  );
}

function renderHarness(props: {
  windowStart: number;
  rowCount: number;
  colCount: number;
  pinTrack?: PinTrackData;
  overlayPlugins?: readonly OverlayPlugin[];
}) {
  let actions!: ReturnType<typeof useDataGridActions>;
  const utils = render(
    <DataGridProvider data={makeRows(10)} columns={columns} getRowId={(r) => r.id} overlayPlugins={props.overlayPlugins}>
      <Harness {...props} onActions={(a) => (actions = a)} />
    </DataGridProvider>,
  );
  return { ...utils, actions: () => actions };
}

afterEach(cleanup);

describe("DataGridOverlays selection-range clamping", () => {
  it("clamps a range overlay to the currently rendered row window", () => {
    const { container, actions } = renderHarness({ windowStart: 4, rowCount: 6, colCount: 3 });
    act(() => {
      actions().selectCell({ col: 0, row: 2 });
      actions().extendTo({ col: 1, row: 8 });
    });

    // window only covers rows [4, 10) — the range [2,9) must clamp to [4,9)
    const overlay = container.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
    expect(overlay).not.toBeNull();
    expect(overlay!.style.gridRowStart).toBe("1"); // (4 - 4) + 1
    expect(overlay!.style.gridRowEnd).toBe("6"); // (9 - 4) + 1
    expect(overlay!.style.gridColumnStart).toBe("1");
    expect(overlay!.style.gridColumnEnd).toBe("3");
  });

  it("renders nothing when the range falls entirely outside the rendered window", () => {
    const { container, actions } = renderHarness({ windowStart: 5, rowCount: 5, colCount: 3 });
    act(() => {
      actions().selectCell({ col: 0, row: 0 });
      actions().extendTo({ col: 0, row: 1 });
    });
    expect(container.querySelector(gridAttrSelector("selectionOverlay"))).toBeNull();
  });

  it("places the active-cell ring at the window-relative grid line", () => {
    const { container, actions } = renderHarness({ windowStart: 4, rowCount: 6, colCount: 3 });
    act(() => actions().selectCell({ col: 1, row: 6 }));

    const ring = container.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"));
    expect(ring).not.toBeNull();
    expect(ring!.style.gridRowStart).toBe("3"); // (6 - 4) + 1
    expect(ring!.style.gridColumnStart).toBe("2"); // col 1 + 1
  });

  it("omits the active-cell ring when the active cell is outside the rendered window", () => {
    const { container, actions } = renderHarness({ windowStart: 4, rowCount: 6, colCount: 3 });
    act(() => actions().selectCell({ col: 0, row: 0 }));
    expect(container.querySelector(gridAttrSelector("activeCellOverlay"))).toBeNull();
  });

  it("all overlays are pointer-events-none", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3 });
    act(() => actions().selectCell({ col: 0, row: 4 }));

    const overlays = container.querySelectorAll<HTMLElement>(
      `${gridAttrSelector("selectionOverlay")}, ${gridAttrSelector("activeCellOverlay")}`,
    );
    expect(overlays.length).toBeGreaterThan(0);
    overlays.forEach((el) => expect(el.className).toContain("pointer-events-none"));
  });
});

describe("splitRectByPinZones", () => {
  // 5 columns: 0 pinned-left, 1-3 unpinned, 4 pinned-right; unpinned window fully rendered (no virtualization clamp in play).
  const track: PinTrackData = {
    pins: ["left", undefined, undefined, undefined, "right"],
    trackLefts: [0, 80, 180, 280, 380],
    trackRights: [80, 180, 280, 380, 480],
    renderedUnpinnedRange: { start: 1, end: 4 },
  };

  it("returns a single unpinned segment when the rect doesn't touch a pinned zone", () => {
    const segments = splitRectByPinZones({ x: 1, y: 0, width: 2, height: 1 }, track);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.pin).toBeUndefined();
    expect(segments[0]!.pinStyle).toBeUndefined();
    expect(segments[0]!.rect).toEqual({ x: 1, y: 0, width: 2, height: 1 });
  });

  it("splits a rect spanning pinned-left + unpinned into 2 segments", () => {
    const segments = splitRectByPinZones({ x: 0, y: 0, width: 2, height: 1 }, track);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.pin).toBe("left");
    expect(segments[0]!.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(segments[0]!.pinStyle?.position).toBe("relative");
    expect(segments[1]!.pin).toBeUndefined();
    expect(segments[1]!.rect).toEqual({ x: 1, y: 0, width: 1, height: 1 });
  });

  it("splits a full-width rect into 3 contiguous segments: pinned-left, unpinned, pinned-right", () => {
    const segments = splitRectByPinZones({ x: 0, y: 0, width: 5, height: 2 }, track);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.pin)).toEqual(["left", undefined, "right"]);
    expect(segments[0]!.rect).toEqual({ x: 0, y: 0, width: 1, height: 2 });
    expect(segments[1]!.rect).toEqual({ x: 1, y: 0, width: 3, height: 2 });
    expect(segments[2]!.rect).toEqual({ x: 4, y: 0, width: 1, height: 2 });
  });

  it("returns a single pinned-right segment when the rect is entirely inside that zone", () => {
    const segments = splitRectByPinZones({ x: 4, y: 3, width: 1, height: 4 }, track);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.pin).toBe("right");
    expect(segments[0]!.rect).toEqual({ x: 4, y: 3, width: 1, height: 4 });
  });

  it("shares one offset across a multi-column contiguous pinned segment (uses the first column's track)", () => {
    const wideTrack: PinTrackData = {
      pins: ["left", "left", undefined, "right", "right"],
      trackLefts: [0, 80, 180, 280, 380],
      trackRights: [80, 180, 280, 380, 480],
      renderedUnpinnedRange: { start: 2, end: 3 },
    };
    const segments = splitRectByPinZones({ x: 0, y: 0, width: 2, height: 1 }, wideTrack);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.pin).toBe("left");
    // firstCol of the segment is 0, so the offset must be pinnedInsetStyle("left", 0, trackLefts[0], trackRights[0])
    expect(segments[0]!.pinStyle?.insetInlineStart).toContain("--grid-pin-left-0");
  });

  it("returns no segments when the rect doesn't intersect any zone (out of range)", () => {
    const segments = splitRectByPinZones({ x: 10, y: 0, width: 1, height: 1 }, track);
    expect(segments).toHaveLength(0);
  });

  it("handles an all-unpinned track as a single unpinned segment (no pin zones)", () => {
    const flatTrack: PinTrackData = {
      pins: [undefined, undefined, undefined],
      trackLefts: [0, 100, 200],
      trackRights: [100, 200, 300],
      renderedUnpinnedRange: { start: 0, end: 3 },
    };
    const segments = splitRectByPinZones({ x: 0, y: 0, width: 3, height: 1 }, flatTrack);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.pin).toBeUndefined();
  });

  it("clamps the unpinned segment to the rendered unpinned window, leaving pinned zones unclamped", () => {
    // same 5-column layout, but only unpinned column 2 is currently rendered (virtualized window).
    const virtualizedTrack: PinTrackData = { ...track, renderedUnpinnedRange: { start: 2, end: 3 } };
    const segments = splitRectByPinZones({ x: 0, y: 0, width: 5, height: 1 }, virtualizedTrack);
    expect(segments).toHaveLength(3);
    expect(segments[0]!.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 }); // pinned-left: unclamped, full
    expect(segments[1]!.rect).toEqual({ x: 2, y: 0, width: 1, height: 1 }); // unpinned: clamped to [2,3)
    expect(segments[2]!.rect).toEqual({ x: 4, y: 0, width: 1, height: 1 }); // pinned-right: unclamped, full
  });
});

describe("DataGridOverlays pin-aware segmentation", () => {
  const pinTrack: PinTrackData = {
    pins: ["left", undefined, "right"],
    trackLefts: [0, 80, 180],
    trackRights: [80, 180, 280],
    renderedUnpinnedRange: { start: 1, end: 2 },
  };

  it("marks pinned-zone overlay segments with data-pinned and leaves the middle segment unmarked", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack });
    act(() => {
      actions().selectCell({ col: 0, row: 2 });
      actions().extendTo({ col: 2, row: 2 });
    });

    const overlays = [...container.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))];
    expect(overlays).toHaveLength(3);
    const pinnedCount = overlays.filter((el) => el.dataset["pinned"] !== undefined).length;
    expect(pinnedCount).toBe(2); // left + right zones
    const unpinned = overlays.find((el) => el.dataset["pinned"] === undefined);
    expect(unpinned).toBeDefined();
  });

  it("ranks pinned overlay segments above pinned cells (GRID_LAYER.pinnedOverlaySegment)", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack });
    act(() => {
      actions().selectCell({ col: 0, row: 2 });
      actions().extendTo({ col: 2, row: 2 });
    });

    const pinnedOverlay = container.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay") + gridAttrSelector("pinned"))!;
    expect(pinnedOverlay.style.zIndex).toBe(String(GRID_LAYER.pinnedOverlaySegment));
    expect(GRID_LAYER.pinnedOverlaySegment).toBeGreaterThan(GRID_LAYER.pinnedCell);
  });

  it("does not segment or mark overlays when pinTrack has no pinned columns", () => {
    const flatTrack: PinTrackData = {
      pins: [undefined, undefined, undefined],
      trackLefts: [0, 80, 180],
      trackRights: [80, 180, 280],
      renderedUnpinnedRange: { start: 0, end: 3 },
    };
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack: flatTrack });
    act(() => {
      actions().selectCell({ col: 0, row: 2 });
      actions().extendTo({ col: 2, row: 2 });
    });

    const overlays = [...container.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))];
    expect(overlays).toHaveLength(1);
    expect(overlays[0]!.dataset["pinned"]).toBeUndefined();
  });

  it("applies the active-cell ring's pin offset when the active column is pinned, keeping z-index 10", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack });
    act(() => actions().selectCell({ col: 2, row: 1 }));

    const ring = container.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    expect(ring.dataset["pinned"]).toBe("");
    expect(ring.style.insetInlineStart).toContain("--grid-pin-right-2");
    expect(ring.className).toContain("z-10");
  });

  it("leaves the active-cell ring unpinned when the active column isn't pinned", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack });
    act(() => actions().selectCell({ col: 1, row: 1 }));

    const ring = container.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    expect(ring.dataset["pinned"]).toBeUndefined();
    expect(ring.style.insetInlineStart).toBe("");
  });

  it("splits a row-channel band across pinned-left + unpinned + pinned-right with no gaps", () => {
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, pinTrack });
    act(() => actions().selectRow(3));

    const overlays = [...container.querySelectorAll<HTMLElement>(gridAttrSelector("selectionOverlay"))];
    expect(overlays).toHaveLength(3);
    // contiguous: segment column starts/ends chain with no gap (grid columns 1,2 then 2,3 then 3,4)
    const starts = overlays.map((el) => Number(el.style.gridColumnStart)).sort((a, b) => a - b);
    const ends = overlays.map((el) => Number(el.style.gridColumnEnd)).sort((a, b) => a - b);
    expect(starts).toEqual([1, 2, 3]);
    expect(ends).toEqual([2, 3, 4]);
  });
});

describe("overlayPlugins seam (workplan #48)", () => {
  it("renders a registered plugin into the overlay layer, passing it the expected ctx shape", () => {
    let receivedCtx: Parameters<OverlayPlugin>[0] | undefined;
    const dummyPlugin: OverlayPlugin = (ctx) => {
      receivedCtx = ctx;
      return <div data-testid="dummy-overlay-plugin">plugin content</div>;
    };

    const { container } = renderHarness({ windowStart: 2, rowCount: 6, colCount: 3, overlayPlugins: [dummyPlugin] });

    expect(container.querySelector('[data-testid="dummy-overlay-plugin"]')).not.toBeNull();
    expect(receivedCtx).toBeDefined();
    expect(receivedCtx!.windowStart).toBe(2);
    expect(receivedCtx!.clampRowStart).toBe(2);
    expect(receivedCtx!.clampRowEnd).toBe(8);
    expect(receivedCtx!.colCount).toBe(3);
    expect(receivedCtx!.colOffset).toBe(1);
    expect(typeof receivedCtx!.splitRectByPinZones).toBe("function");
    expect(typeof receivedCtx!.clampRectToWindow).toBe("function");
  });

  it("renders nothing extra when overlayPlugins is omitted", () => {
    const { container } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3 });
    expect(container.querySelector('[data-testid="dummy-overlay-plugin"]')).toBeNull();
  });

  it("renders multiple registered plugins, each receiving ctx", () => {
    let callCount = 0;
    const countingPlugin: OverlayPlugin = () => {
      callCount += 1;
      return null;
    };

    renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, overlayPlugins: [countingPlugin, countingPlugin] });
    expect(callCount).toBe(2);
  });

  it("renders plugin content before the active-cell ring in DOM order (local focus still paints on top)", () => {
    const dummyPlugin: OverlayPlugin = () => <div data-grid-dummy-plugin-overlay="" aria-hidden="true" />;
    const { container, actions } = renderHarness({ windowStart: 0, rowCount: 10, colCount: 3, overlayPlugins: [dummyPlugin] });
    act(() => actions().selectCell({ col: 0, row: 2 }));

    const pluginOverlay = container.querySelector("[data-grid-dummy-plugin-overlay]")!;
    const ring = container.querySelector(gridAttrSelector("activeCellOverlay"))!;
    expect(pluginOverlay.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
