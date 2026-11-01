import { describe, expect, it } from "vitest";
import { buildExportRows } from "@/registry/default/blocks/data-grid-io/export-grid";
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
});
