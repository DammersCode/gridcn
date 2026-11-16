import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeColumnLayout } from "../store/compute";
import { createDataGridStore } from "../store/create-store";
import type { AnyColumnDef, InternalSyncProps } from "../store/types";
import { readColumnPin, withLogicalPin } from "./column-pin";

const column = (pin?: unknown) => ({ id: "a", header: "A", pin }) as unknown as AnyColumnDef;

afterEach(() => vi.restoreAllMocks());

describe("readColumnPin", () => {
  it("passes start and end through", () => {
    expect([readColumnPin("start"), readColumnPin("end")]).toEqual(["start", "end"]);
  });

  it("reads left and right as start and end and warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect([readColumnPin("left"), readColumnPin("right")]).toEqual(["start", "end"]);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("rejects other values", () => {
    expect([readColumnPin("middle"), readColumnPin(undefined), readColumnPin("toString")]).toEqual([undefined, undefined, undefined]);
  });
});

describe("legacy pin values", () => {
  it("withLogicalPin migrates a def once and keeps logical defs by identity", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacy = column("left");
    expect(withLogicalPin(legacy).pin).toBe("start");
    expect(withLogicalPin(legacy)).toBe(withLogicalPin(legacy));
    const logical = column("end");
    expect(withLogicalPin(logical)).toBe(logical);
  });

  it("normalizeColumnLayout reads a saved pins map with left and right", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { columns } = normalizeColumnLayout([column(), { ...column(), id: "b" }], { pins: { a: "left", b: "right" } as never }, []);
    expect(columns.map((c) => c.pin)).toEqual(["start", "end"]);
  });
});

describe("setColumnPin", () => {
  it("reads a legacy side as its logical name", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createDataGridStore({ data: [], columns: [{ id: "a", header: "A", accessorKey: "a" }], getRowId: () => "x" } as unknown as InternalSyncProps);
    store.getState().actions.setColumnPin("a", "left" as never);
    expect(store.getState().columns[0]!.pin).toBe("start");
  });
});

describe("legacy pin warning per grid", () => {
  it("warns once for each grid that reads a legacy pin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const columns = [{ id: "a", header: "A", accessorKey: "a", pin: "left" }];
    const create = () => createDataGridStore({ data: [], columns, getRowId: () => "x" } as unknown as InternalSyncProps);
    create();
    create();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("is now"))).toHaveLength(2);
  });
});
