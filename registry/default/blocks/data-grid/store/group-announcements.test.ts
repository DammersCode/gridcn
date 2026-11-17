import { describe, expect, it } from "vitest";
import type { GroupNode } from "../group-types";
import { loadedRowCount, newlyFailedGroup } from "./announcements";

const node = (id: string, status?: "loading" | "failed"): GroupNode => ({ id, depth: 0, columnId: "c", key: id, label: id, count: 1, childCount: 1, aggregates: {}, ...(status ? { status } : {}) });
const layout = (...rows: GroupNode[]) => ({ rows, leafCount: rows.length });

describe("newlyFailedGroup", () => {
  it("names a group that turned failed", () => {
    const before = { groupLayout: layout(node("A", "loading"), node("B")) };
    const after = { groupLayout: layout(node("A", "failed"), node("B")), groupMode: "server" as const };
    expect(newlyFailedGroup(after, before)?.id).toBe("A");
  });

  it("stays silent for a group that was failed already, a client grid, and an unchanged layout", () => {
    const failed = layout(node("A", "failed"));
    expect(newlyFailedGroup({ groupLayout: layout(node("A", "failed")), groupMode: "server" }, { groupLayout: failed })).toBeUndefined();
    expect(newlyFailedGroup({ groupLayout: failed, groupMode: "client" }, { groupLayout: null })).toBeUndefined();
    expect(newlyFailedGroup({ groupLayout: failed, groupMode: "server" }, { groupLayout: failed })).toBeUndefined();
  });
});

describe("loadedRowCount", () => {
  it("counts neither holes nor group rows", () => {
    expect(loadedRowCount([-1, 0, 1, 2], [{}, {}, undefined])).toBe(2);
  });
});
