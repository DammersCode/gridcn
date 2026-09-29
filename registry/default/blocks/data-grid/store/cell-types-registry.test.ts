import { describe, expect, it } from "vitest";
import { cellTypes, textCellType } from "../cell-types/cell-types";
import type { CellType } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", accessorKey: "name" }];

/** A stand-in custom type: the tests assert identity, not its pipeline. */
function fakeType(label: string): CellType {
  return {
    ...textCellType,
    toText: (value: unknown) => `${label}:${value}`,
  } as unknown as CellType;
}

function makeStore(cellTypesProp: Record<string, CellType | null> | undefined) {
  return createDataGridStore({
    data: [{ id: "1", name: "a" }],
    columns,
    getRowId: (row) => (row as Row).id,
    cellTypes: cellTypesProp as InternalSyncProps["cellTypes"],
  } as InternalSyncProps);
}

describe("cellTypes registry resolution", () => {
  it("resolves all five built-ins when the prop is omitted", () => {
    const registry = makeStore(undefined).getState().cellTypes;
    expect(Object.keys(registry).sort()).toEqual(["checkbox", "date", "number", "select", "text"]);
    expect(registry["text"]).toBe(cellTypes.text);
    expect(registry["number"]).toBe(cellTypes.number);
  });

  it("merges a custom type over the built-ins — unnamed built-ins keep working", () => {
    const currency = fakeType("currency");
    const registry = makeStore({ currency }).getState().cellTypes;
    expect(registry["currency"]).toBe(currency);
    expect(registry["text"]).toBe(cellTypes.text);
    expect(registry["number"]).toBe(cellTypes.number);
  });

  it("an entry for a built-in key replaces that built-in", () => {
    const custom = fakeType("custom-text");
    const registry = makeStore({ text: custom }).getState().cellTypes;
    expect(registry["text"]).toBe(custom);
    expect(registry["number"]).toBe(cellTypes.number);
  });

  it("a null entry removes a built-in", () => {
    const registry = makeStore({ number: null }).getState().cellTypes;
    expect(registry["number"]).toBeUndefined();
    expect(registry["text"]).toBe(cellTypes.text);
  });

  it("a null entry removes a previously provided custom type", () => {
    const currency = fakeType("currency");
    const registry = makeStore({ currency, text: null }).getState().cellTypes;
    expect(registry["currency"]).toBe(currency);
    expect(registry["text"]).toBeUndefined();
    expect(registry["number"]).toBe(cellTypes.number);
  });
});
