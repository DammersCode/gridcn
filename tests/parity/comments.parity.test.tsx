import { describe, expect, it } from "vitest";
import { useDataGridComments, type CellComment, type OrphanedCommentsCtx, type UseDataGridCommentsResult } from "@/registry/default/blocks/data-grid-comments/data-grid-comments";
import { ALL_MODES, mountMode } from "./modes";

const author = { id: "ada", name: "Ada" };
const seed = (rowId: string): CellComment => ({ id: `c-${rowId}`, rowId, columnId: "name", text: `Note on ${rowId}`, author, createdAt: 1, updatedAt: 1, version: 1, resolved: false });

async function mountComments(mode: Parameters<typeof mountMode>[0], rowIds: string[]) {
  const orphaned: OrphanedCommentsCtx[] = [];
  let handle!: UseDataGridCommentsResult;
  const grid = await mountMode(mode, {
    useExtra: () => {
      handle = useDataGridComments({ currentUser: author, defaultComments: rowIds.map(seed), onOrphanedComments: (ctx) => orphaned.push(ctx) });
      return { plugins: [handle.plugin] };
    },
  });
  return { grid, handle: () => handle, orphaned };
}

describe.each(ALL_MODES)("comments in mode %s", (mode) => {
  it("keeps comments keyed by row id through a sort and a filter, and refuses to open a filtered-out row", async () => {
    const { grid, handle } = await mountComments(mode, ["r0", "r1"]);
    const visible = grid.viewIds();
    expect(handle().getComments().map((c) => c.rowId).sort()).toEqual(["r0", "r1"]);
    grid.setSorts([{ columnId: "n", direction: "desc" }] as never);
    await grid.settle();
    expect(handle().getComments()).toHaveLength(2);
    grid.setFilters([{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as never);
    await grid.settle();
    const shown = grid.viewIds();
    for (const rowId of ["r0", "r1"]) {
      expect(handle().openComments({ rowId, columnId: "name" })).toBe(shown.includes(rowId));
    }
    expect(handle().getComments()).toHaveLength(2);
    expect(visible.length).toBeGreaterThan(0);
  });

  it("keeps an anonymous comment with no user and no save callback", async () => {
    let handle!: UseDataGridCommentsResult;
    const grid = await mountMode(mode, {
      useExtra: () => {
        handle = useDataGridComments();
        return { plugins: [handle.plugin] };
      },
    });
    const { author: _author, ...anonymous } = seed("r0");
    expect(handle.applyRemote([{ kind: "upsert", comment: anonymous }]).applied).toBe(1);
    grid.setSorts([{ columnId: "n", direction: "desc" }] as never);
    await grid.settle();
    expect(handle.getComments().map((c) => c.id)).toEqual(["c-r0"]);
    expect("author" in (handle.getComments()[0] ?? { author: 1 })).toBe(false);
  });

  it("returns false for an unknown row and for a hidden column", async () => {
    const { handle } = await mountComments(mode, ["r0"]);
    expect(handle().openComments({ rowId: "nope", columnId: "name" })).toBe(false);
    expect(handle().openComments({ rowId: "r0", columnId: "missing" })).toBe(false);
  });

  it("reports orphaned comments when their row is deleted and keeps the comments", async () => {
    const { grid, handle, orphaned } = await mountComments(mode, ["r0"]);
    if (!grid.viewIds().includes("r0")) return;
    grid.act(() => void grid.state().actions.deleteRows(["r0"]));
    await grid.settle();
    expect(orphaned.length).toBeGreaterThan(0);
    expect(orphaned[0]?.rowIds).toContain("r0");
    expect(handle().getComments()).toHaveLength(1);
  });
});
