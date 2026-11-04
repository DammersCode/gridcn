import { describe, expect, it, vi } from "vitest";
import { buildExportRows, exportGrid } from "@/registry/default/blocks/data-grid-io/export-grid";
import { ALL_MODES, mountMode } from "./modes";

const firstColumn = (rows: string[][]) => rows.map((row) => row[0]);

describe.each(ALL_MODES)("export and print rows in mode %s", (mode) => {
  it("the view scope follows the displayed order and the mode's filter rules", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }]);
    const names = firstColumn(buildExportRows(grid.state(), "view"));
    const expected: Record<string, string[]> = {
      PC: ["Name 3", "Name 2"],
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
    expect(names.length).toBe(mode === "PC" || mode === "PS" ? 4 : 6);
  });

  it("print text uses the display form of the same rows", async () => {
    const grid = await mountMode(mode);
    const display = buildExportRows(grid.state(), "view", { text: "display" });
    expect(display).toHaveLength(grid.viewIds().length);
    expect(display[0]).toHaveLength(2);
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
});
