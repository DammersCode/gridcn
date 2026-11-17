import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { applyFunctionSeeds } from "./function-seed";
import type { InternalSyncProps } from "./types";

const init = (extra: object) =>
  ({ data: [{ id: "1" }], columns: [{ id: "id", header: "ID", accessorKey: "id" }], getRowId: (r: { id: string }) => r.id, ...extra }) as unknown as InternalSyncProps;

afterEach(() => vi.restoreAllMocks());

describe("a default seed next to its controlled state", () => {
  const seedWarnings = (warn: ReturnType<typeof vi.spyOn>) => warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("is ignored"));

  it("warns once with the old and the new form", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = init({ defaultSortState: [], sortState: [] });
    const store = createDataGridStore(props as never);
    applyFunctionSeeds(store, props);
    expect(seedWarnings(warn)).toHaveLength(1);
    expect(String(seedWarnings(warn)[0]![0])).toContain("defaultSortState");
    expect(String(seedWarnings(warn)[0]![0])).toContain("defaultSpec");
  });

  it("stays silent when the state is uncontrolled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const props = init({ defaultSortState: [] });
    applyFunctionSeeds(createDataGridStore(props as never), props);
    expect(seedWarnings(warn)).toHaveLength(0);
  });
});
