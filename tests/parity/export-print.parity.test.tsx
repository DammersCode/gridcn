import { describe, expect, it, vi } from "vitest";
import { buildExportRows, exportGrid } from "@/registry/default/blocks/data-grid-io/export-grid";
import { printGrid, type PrintGridOptions } from "@/registry/default/blocks/data-grid-io/print-grid";
import { ALL_MODES, mountMode, type Mounted } from "./modes";

const firstColumn = (rows: string[][]) => rows.map((row) => row[0]);

/** Prints into the hidden iframe without the print dialog and returns the printed first column. */
function printedNames(grid: Mounted, options?: PrintGridOptions): string[] {
  const append = document.body.append.bind(document.body);
  const spy = vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
    append(...nodes);
    for (const node of nodes) if (node instanceof HTMLIFrameElement && node.contentWindow) node.contentWindow.print = () => {};
  });
  try {
    printGrid(grid.state(), options);
  } finally {
    spy.mockRestore();
  }
  const doc = document.querySelector("iframe")!.contentDocument!;
  return [...doc.querySelectorAll("tbody > tr")].map((tr) => tr.querySelector("td")!.textContent!);
}

describe.each(ALL_MODES)("export and print rows in mode %s", (mode) => {
  it("the view scope follows the displayed order and the mode's filter rules", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }]);
    const names = firstColumn(buildExportRows(grid.state(), "view"));
    const expected: Record<string, string[]> = {
      PS: ["Name 3", "Name 2"],
      SS: ["Name 2", "Name 3", "Name 4", "Name 5"],
      FS: ["Name 5", "Name 4", "Name 3", "Name 2", "Name 1", "Name 0"],
    };
    expect(names).toEqual(expected[mode] ?? ["Name 5", "Name 4", "Name 3", "Name 2"]);
  });

  it("the all scope covers the rows the grid holds, never a hole", async () => {
    const grid = await mountMode(mode);
    const names = firstColumn(buildExportRows(grid.state(), "all"));
    expect(names).toEqual(grid.held().map((row) => row.name));
    expect(names.length).toBe(mode === "PS" ? 4 : 6);
  });

  it("the display text export covers the same rows", async () => {
    const grid = await mountMode(mode);
    const display = buildExportRows(grid.state(), "view", { text: "display" });
    expect(display).toHaveLength(grid.fullViewIds().length);
    expect(display[0]).toHaveLength(2);
  });

  it("printGrid prints the rows of the view, every page of a paged grid", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(printedNames(grid)).toEqual(firstColumn(buildExportRows(grid.state(), "view")));
    expect(printedNames(grid)).toEqual(grid.fullViewIds().map((id) => String(grid.cell(id, "name"))));
  });

  it("a source export hands the mode's current spec to the source and exports only the source rows", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }]);
    let blob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => ((blob = b as Blob), "blob:x"));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const source = vi.fn((_ctx: { spec: { sorts: unknown; filters: unknown } }) => [{ n: 1, name: "from-source" }]);
    const result = await exportGrid(grid.state(), { source, csvBom: false }).finally(() => vi.restoreAllMocks());
    const spec = source.mock.calls[0]![0].spec;
    expect(spec.sorts).toEqual([{ columnId: "n", direction: "desc" }]);
    expect(spec.filters).toHaveLength(1);
    expect(result).toEqual({ rowCount: 1, truncated: false });
    expect(await blob!.text()).toContain("from-source");
    expect(await blob!.text()).not.toContain("Name 3");
  });

  it("output receives the mode's rows with columns and formatCell applied and nothing downloads", async () => {
    const grid = await mountMode(mode);
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const output = vi.fn<(file: Blob, ctx: { fileName: string; format: string }) => void>();
    const result = await exportGrid(grid.state(), {
      output,
      columns: ["n", "name"],
      formatCell: ({ column, value }) => (column.id === "n" ? `#${String(value)}` : undefined),
      csvBom: false,
    }).finally(() => createUrl.mockRestore());
    const [file, ctx] = output.mock.calls[0]!;
    const lines = (await file.text()).split("\r\n");
    expect(ctx).toMatchObject({ fileName: "export.csv", format: "csv" });
    expect(lines[0]).toBe("N,Name");
    expect(lines).toHaveLength(result.rowCount + 1);
    expect(lines.slice(1)).toEqual(grid.fullViewIds().map((id) => `#${String(grid.cell(id, "n"))},`));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("a source export applies columns and formatCell to the source rows and tells the source the column ids", async () => {
    const grid = await mountMode(mode);
    const output = vi.fn<(file: Blob) => void>();
    const source = vi.fn((_ctx: { columnIds: readonly string[] }) => [{ n: 7, name: "from-source" }]);
    await exportGrid(grid.state(), { output, source, columns: ["name", "n"], formatCell: ({ value }) => (typeof value === "number" ? value * 2 : `<${String(value)}>`), csvBom: false });
    expect(source.mock.calls[0]![0].columnIds).toEqual(["name", "n"]);
    expect(await output.mock.calls[0]![0].text()).toBe("Name,N\r\n<from-source>,14");
  });

  it("an unknown column id rejects before the source runs", async () => {
    const grid = await mountMode(mode);
    const source = vi.fn(() => []);
    await expect(exportGrid(grid.state(), { source, columns: ["missing"] })).rejects.toBeInstanceOf(RangeError);
    expect(source).not.toHaveBeenCalled();
  });
});

describe("export and print with client pagination", () => {
  it("export and print cover every page; scope page writes the shown page only", async () => {
    const grid = await mountMode("PC");
    grid.goToPage(2);
    const every = ["Name 0", "Name 1", "Name 2", "Name 3", "Name 4", "Name 5"];
    expect(firstColumn(buildExportRows(grid.state(), "view"))).toEqual(every);
    expect(printedNames(grid)).toEqual(every);
    expect(firstColumn(buildExportRows(grid.state(), "page"))).toEqual(["Name 4", "Name 5"]);
    expect(printedNames(grid, { scope: "page" })).toEqual(["Name 4", "Name 5"]);
  });
});
