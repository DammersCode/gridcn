import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { DEFAULT_LABELS, CompactSelection, type CellType, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { printGrid } from "./print-grid";

type Row = { id: string; name: string; note: string };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

function makeColumns(): ColumnDef<Row, unknown>[] {
  return [
    { id: "name", header: "Name", accessorKey: "name", type: "text" },
    { id: "note", header: "Note", accessorKey: "note", type: "text" },
  ];
}

function makeState(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data: Row[] = [
    { id: "1", name: "Alice", note: "a" },
    { id: "2", name: "Bob", note: "b" },
    { id: "3", name: "Carl", note: "c" },
  ];
  const columns = makeColumns();
  return {
    data,
    visibleColumns: columns as never,
    viewIndex: [0, 1, 2],
    cellTypes: { text: textCellType as never },
    labels: DEFAULT_LABELS,
    selection: { current: null, rows: CompactSelection.empty(), columns: CompactSelection.empty() },
    ...overrides,
  } as unknown as DataGridStoreState;
}

// The iframe's window only exists after insertion, so the spy hooks the append entry points and
// patches `print` on each appended iframe's contentWindow (same helper as print-grid.test.ts).
function stubIframePrint(): { spy: ReturnType<typeof vi.fn>; restore: () => void } {
  const spy = vi.fn();
  const patched = new WeakSet<object>();
  const spies: MockInstance[] = [];
  for (const proto of [Element.prototype, Document.prototype]) {
    const target = proto as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const method of ["append", "appendChild"] as const) {
      const original = target[method];
      if (typeof original !== "function") continue;
      spies.push(
        vi.spyOn(target, method).mockImplementation(function (this: unknown, ...nodes: unknown[]) {
          const result = original.call(this, ...nodes);
          for (const node of nodes) {
            if (node instanceof HTMLIFrameElement) {
              const win = node.contentWindow;
              if (win && !patched.has(win)) {
                patched.add(win);
                win.print = () => spy();
              }
            }
          }
          return result;
        }),
      );
    }
  }
  return { spy, restore: () => spies.forEach((s) => s.mockRestore()) };
}

function lastIframe(): HTMLIFrameElement {
  const iframe = document.querySelector("iframe");
  expect(iframe).not.toBeNull();
  return iframe!;
}

function tableOf(iframe: HTMLIFrameElement): { rows: string[][]; headers: string[] | null; note: string | null } {
  const doc = iframe.contentDocument!;
  const table = doc.querySelector("table")!;
  const thead = table.querySelector("thead");
  const headers = thead ? [...thead.querySelectorAll("th")].map((th) => th.textContent!) : null;
  const rows = [...table.querySelectorAll("tbody > tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent!),
  );
  const note = doc.querySelector("p")?.textContent ?? null;
  return { rows, headers, note };
}

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

describe("printGrid", () => {
  it("opens a hidden sandboxed iframe with a CSP meta and calls print once", () => {
    const { spy, restore } = stubIframePrint();
    try {
      printGrid(makeState());
      const iframe = lastIframe();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(iframe.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
      expect(iframe.getAttribute("sandbox")!.split(" ")).not.toContain("allow-scripts");
      const meta = iframe.contentDocument!.querySelector('meta[http-equiv="Content-Security-Policy"]');
      expect(meta?.getAttribute("content")).toBe("default-src 'none'; style-src 'unsafe-inline'");
      expect(iframe.contentDocument!.querySelector("style")!.textContent).toContain("@page");
    } finally {
      restore();
    }
  });

  it("renders hostile values as plain text, never as markup", () => {
    const { restore } = stubIframePrint();
    try {
      printGrid(
        makeState({
          data: [
            { id: "1", name: '<img src=x onerror=alert(1)>', note: "</table><script>evil()</script>" },
            { id: "2", name: 'he said "hi"', note: "plain" },
          ],
          viewIndex: [0, 1],
          visibleColumns: [
            { id: "name", header: 'Co"l', accessorKey: "name", type: "text" },
            { id: "note", header: "Note", accessorKey: "note", type: "text" },
          ] as never,
        }),
      );
      const doc = lastIframe().contentDocument!;
      expect(doc.querySelector("img")).toBeNull();
      expect(doc.querySelector("script")).toBeNull();
      const { rows, headers } = tableOf(lastIframe());
      expect(headers).toEqual(['Co"l', "Note"]);
      expect(rows[0]).toEqual(['<img src=x onerror=alert(1)>', "</table><script>evil()</script>"]);
    } finally {
      restore();
    }
  });

  it("prints the view scope in sort and filter order", () => {
    const { restore } = stubIframePrint();
    try {
      // viewIndex simulates an active sort: Carl, Alice, Bob
      printGrid(makeState({ viewIndex: [2, 0, 1] }));
      expect(tableOf(lastIframe()).rows).toEqual([
        ["Carl", "c"],
        ["Alice", "a"],
        ["Bob", "b"],
      ]);
    } finally {
      restore();
    }
  });

  it("prints the selected rows in view order for the selection scope", () => {
    const { restore } = stubIframePrint();
    try {
      const state = makeState({
        selection: { current: null, rows: CompactSelection.fromArray([0, 2]), columns: CompactSelection.empty() },
      });
      printGrid(state, { scope: "selection" });
      expect(tableOf(lastIframe()).rows).toEqual([
        ["Alice", "a"],
        ["Carl", "c"],
      ]);
    } finally {
      restore();
    }
  });

  it("prints visible columns only, in view order", () => {
    const { restore } = stubIframePrint();
    try {
      const columns: ColumnDef<Row, unknown>[] = [
        { id: "name", header: "Name", accessorKey: "name", type: "text" },
        { id: "note", header: "Note", accessorKey: "note", type: "text" },
      ];
      // the "hidden" column is simply absent from visibleColumns
      printGrid(makeState({ visibleColumns: [columns[1]!] as never, viewIndex: [0] }));
      const { rows, headers } = tableOf(lastIframe());
      expect(headers).toEqual(["Note"]);
      expect(rows).toEqual([["a"]]);
    } finally {
      restore();
    }
  });

  it("uses the cell type's display text, not its export text", () => {
    const { restore } = stubIframePrint();
    try {
      const formatted: CellType<Row, string> = {
        ...textCellType,
        toText: (value) => `raw:${value}`,
        toDisplayText: (value) => `fmt(${value})`,
      };
      printGrid(
        makeState({
          data: [{ id: "1", name: "x", note: "2024-01-15" }],
          viewIndex: [0],
          cellTypes: { text: textCellType as never, note: formatted as never },
          visibleColumns: [
            { id: "name", header: "Name", accessorKey: "name", type: "text" },
            { id: "note", header: "Note", accessorKey: "note", type: "note" },
          ] as never,
        }),
      );
      expect(tableOf(lastIframe()).rows).toEqual([["x", "fmt(2024-01-15)"]]);
    } finally {
      restore();
    }
  });

  it("prints the headerText over the header string", () => {
    const { restore } = stubIframePrint();
    try {
      printGrid(
        makeState({
          visibleColumns: [
            { id: "name", header: "Name", headerText: "Person", accessorKey: "name", type: "text" },
            { id: "note", header: "Note", accessorKey: "note", type: "text" },
          ] as never,
        }),
      );
      expect(tableOf(lastIframe()).headers).toEqual(["Person", "Note"]);
    } finally {
      restore();
    }
  });

  it("caps rows at maxRows and adds the truncation note", () => {
    const { restore } = stubIframePrint();
    try {
      const data = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `p${i}`, note: "n" }));
      printGrid(makeState({ data: data as never, viewIndex: data.map((_, i) => i) }), { maxRows: 3 });
      const { rows, note } = tableOf(lastIframe());
      expect(rows).toHaveLength(3);
      expect(note).toBe("Printed 3 of 10 rows");
    } finally {
      restore();
    }
  });

  // 500,000 DOM cells in jsdom take several seconds even on a quiet machine; under the parallel
  // unit-suite load the default 5 s timeout flakes, so give the test the generous wall budget
  // commit-perf.test.ts uses for its heavy cases.
  it("cuts the printed rows to fit the 500,000-cell ceiling", () => {
    const { restore } = stubIframePrint();
    try {
      const columnCount = 60;
      const columns = Array.from({ length: columnCount }, (_, i) => ({ id: `c${i}`, header: `C${i}`, accessorKey: `c${i}`, type: "text" }));
      const rowCount = 10_000;
      const data = Array.from({ length: rowCount }, (_, i) => {
        const row: Record<string, unknown> = { id: String(i) };
        for (let c = 0; c < columnCount; c++) row[`c${c}`] = "v";
        return row;
      });
      // 10,000 rows x 60 columns = 600,000 cells: the ceiling (floor(500,000 / 60) = 8,333) must cut them
      printGrid(
        makeState({
          data: data as never,
          viewIndex: data.map((_, i) => i),
          visibleColumns: columns as never,
          cellTypes: { text: textCellType as never },
        }),
      );
      const { rows, note } = tableOf(lastIframe());
      expect(rows).toHaveLength(Math.floor(500_000 / columnCount));
      expect(note).toBe(`Printed ${Math.floor(500_000 / columnCount)} of ${rowCount} rows`);
    } finally {
      restore();
    }
  }, 30_000);

  it("removes the iframe on afterprint and on the fallback timer", () => {
    const { spy, restore } = stubIframePrint();
    try {
      printGrid(makeState());
      const win = lastIframe().contentWindow!;
      win.dispatchEvent(new Event("afterprint"));
      expect(document.querySelector("iframe")).toBeNull();

      printGrid(makeState());
      expect(lastIframe().contentDocument).not.toBeNull();
      vi.advanceTimersByTime(60_000);
      expect(document.querySelector("iframe")).toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("replaces a previously open print iframe", () => {
    const { spy, restore } = stubIframePrint();
    try {
      printGrid(makeState());
      const first = lastIframe();
      printGrid(makeState());
      const second = lastIframe();
      expect(document.querySelectorAll("iframe")).toHaveLength(1);
      expect(second).not.toBe(first);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("omits the header row and the heading when asked", () => {
    const { restore } = stubIframePrint();
    try {
      printGrid(makeState({ viewIndex: [0] }), { includeHeaders: false });
      expect(tableOf(lastIframe()).headers).toBeNull();
      expect(lastIframe().contentDocument!.querySelector("h1")).toBeNull();
    } finally {
      restore();
    }
  });

  it("prints the title as a heading and document title", () => {
    const { restore } = stubIframePrint();
    try {
      printGrid(makeState(), { title: "Quarterly report" });
      const doc = lastIframe().contentDocument!;
      expect(doc.title).toBe("Quarterly report");
      expect(doc.querySelector("h1")!.textContent).toBe("Quarterly report");
    } finally {
      restore();
    }
  });

  it("picks the orientation from the options or the column count", () => {
    const { restore } = stubIframePrint();
    try {
      const wide = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, header: `C${i}`, accessorKey: `c${i}`, type: "text" }));
      printGrid(makeState({ visibleColumns: wide as never, data: [], viewIndex: [] }));
      expect(lastIframe().contentDocument!.querySelector("style")!.textContent).toContain("A4 landscape");
      printGrid(makeState(), { orientation: "landscape" });
      expect(lastIframe().contentDocument!.querySelector("style")!.textContent).toContain("A4 landscape");
      printGrid(makeState());
      expect(lastIframe().contentDocument!.querySelector("style")!.textContent).toContain("A4 portrait");
    } finally {
      restore();
    }
  });

  it("applies the cell type's alignment to the cells", () => {
    const { restore } = stubIframePrint();
    try {
      const aligned: CellType<Row, string> = { ...textCellType, align: "right" };
      printGrid(
        makeState({
          viewIndex: [0],
          cellTypes: { text: aligned as never },
          visibleColumns: [{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as never,
        }),
      );
      const td = lastIframe().contentDocument!.querySelector("td")!;
      expect(td.style.textAlign).toBe("right");
    } finally {
      restore();
    }
  });

  it("cuts cell texts to the 32,767-character XLSX limit", () => {
    const { restore } = stubIframePrint();
    try {
      const long = "x".repeat(40_000);
      printGrid(makeState({ data: [{ id: "1", name: long, note: "n" }], viewIndex: [0] }));
      expect(lastIframe().contentDocument!.querySelector("td")!.textContent).toHaveLength(32_767);
    } finally {
      restore();
    }
  });

  it("is a no-op without a document (SSR)", () => {
    vi.stubGlobal("document", undefined);
    try {
      expect(() => printGrid(makeState())).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
