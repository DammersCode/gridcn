import { describe, expect, it } from "vitest";
import type { FilterNode } from "@/registry/default/blocks/data-grid/data-grid";
import { appendChild, moveSibling, oppositeJoin, removeNode, updateNode } from "./filter-tree-edit";

const leaf = (filterId: string): FilterNode => ({ filterId, columnId: "name", operator: "equals", value: filterId });
const tree = (): FilterNode[] => [leaf("a"), { filterId: "g", join: "or", filters: [leaf("b"), leaf("c")] }];

describe("filter tree edits", () => {
  it("updateNode edits a nested row", () => {
    const next = updateNode(tree(), "c", (node) => ({ ...node, filterId: "c", columnId: "city", operator: "equals" }) as FilterNode);
    expect(JSON.stringify(next)).toContain('"columnId":"city"');
  });

  it("removeNode removes a row at any level", () => {
    expect(removeNode(tree(), "b")).toEqual([leaf("a"), { filterId: "g", join: "or", filters: [leaf("c")] }]);
  });

  it("removeNode drops a group whose last row is removed", () => {
    expect(removeNode(removeNode(tree(), "b"), "c")).toEqual([leaf("a")]);
  });

  it("removeNode removes a whole group", () => {
    expect(removeNode(tree(), "g")).toEqual([leaf("a")]);
  });

  it("appendChild adds to the top level or to a group", () => {
    expect(appendChild(tree(), undefined, leaf("d")).map((n) => n.filterId)).toEqual(["a", "g", "d"]);
    const grown = appendChild(tree(), "g", leaf("d"))[1] as { filters: FilterNode[] };
    expect(grown.filters.map((n) => n.filterId)).toEqual(["b", "c", "d"]);
  });

  it("moveSibling reorders inside one list only", () => {
    expect(moveSibling(tree(), "g", 0, 1)[1]).toEqual({ filterId: "g", join: "or", filters: [leaf("c"), leaf("b")] });
    expect(moveSibling(tree(), undefined, 0, 1).map((n) => n.filterId)).toEqual(["g", "a"]);
  });

  it("a new group takes the opposite join of its parent", () => {
    expect(oppositeJoin(undefined)).toBe("or");
    expect(oppositeJoin({ join: "or", filters: [] })).toBe("and");
    expect(oppositeJoin({ join: "and", filters: [] })).toBe("or");
  });
});
