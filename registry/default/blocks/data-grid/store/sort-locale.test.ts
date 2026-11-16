import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyColumnDef } from "./types";

const RealCollator = Intl.Collator;
const realLocaleCompare = String.prototype.localeCompare;

type Compute = typeof import("./compute");
type CellTypesModule = typeof import("../cell-types/cell-types");

async function loadUnderSwedishRuntime(): Promise<{ compute: Compute; cellTypes: CellTypesModule["cellTypes"] }> {
  const SwedishRuntimeCollator = function (locale?: string | string[], options?: Intl.CollatorOptions) {
    const supported = [locale ?? []].flat().find((tag) => RealCollator.supportedLocalesOf(tag).length > 0);
    return new RealCollator(supported ?? "sv", options);
  };
  SwedishRuntimeCollator.supportedLocalesOf = RealCollator.supportedLocalesOf;
  vi.stubGlobal("Intl", Object.create(Intl, { Collator: { value: SwedishRuntimeCollator } }));
  String.prototype.localeCompare = function (this: string, that: string, locale?: string | string[], options?: Intl.CollatorOptions) {
    return new RealCollator(locale ?? "sv", options).compare(this, that);
  };
  vi.resetModules();
  const compute = await import("./compute");
  const { cellTypes } = await import("../cell-types/cell-types");
  return { compute, cellTypes };
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.unstubAllGlobals();
  String.prototype.localeCompare = realLocaleCompare;
});

const TYPES = [undefined, "text", "select", "url", "longText"] as const;
const column = (type?: string): readonly AnyColumnDef[] => [
  { id: "v", header: "V", accessorKey: "v", ...(type ? { type } : {}), ...(type === "select" ? { options: { choices: [{ value: "z", label: "z" }, { value: "ä", label: "ä" }] } } : {}) } as AnyColumnDef,
];
const rows = (values: string[]) => values.map((v) => ({ v }));
const orderOf = (data: { v: string }[], view: readonly number[]) => view.map((i) => data[i]!.v);

describe("text sort locale", () => {
  it.each(TYPES)("a %s column sorts with en-US on a Swedish runtime", async (type) => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const data = rows(["z", "ä"]);
    const view = compute.computeViewIndex(data, column(type), [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never);
    expect(orderOf(data, view)).toEqual(["ä", "z"]);
  });

  it.each(TYPES)("a %s column takes the keyed path at 300 rows with en-US", async (type) => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const data = rows([...Array.from({ length: 298 }, (_, i) => `m${String(i).padStart(3, "0")}`), "z", "ä"]);
    const view = compute.computeViewIndex(data, column(type), [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never);
    const ordered = orderOf(data, view);
    expect(ordered.indexOf("ä")).toBeLessThan(ordered.indexOf("m000"));
    expect(ordered[ordered.length - 1]).toBe("z");
  });

  it.each(TYPES)("sortLocale sv orders a %s column the Swedish way", async (type) => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const data = rows(["ä", "z"]);
    const view = compute.computeViewIndex(data, column(type), [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never, null, "sv");
    expect(orderOf(data, view)).toEqual(["z", "ä"]);
  });

  it("a lookup column sorts by label with the sort locale", async () => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const { lookupCellType } = await import("../../data-grid-lookup/lookup-cell-type");
    const data = [{ v: { value: "1", label: "ä" } }, { v: { value: "2", label: "z" } }];
    const sort = (locale?: string) =>
      compute.computeViewIndex(data, [{ id: "v", header: "V", accessorKey: "v", type: "lookup" } as AnyColumnDef], [{ columnId: "v", direction: "asc" }], [], undefined, { ...cellTypes, lookup: lookupCellType } as never, null, locale);
    expect(sort().map((i) => data[i]!.v.label)).toEqual(["ä", "z"]);
    expect(sort("sv").map((i) => data[i]!.v.label)).toEqual(["z", "ä"]);
  });

  it("a well-formed tag the runtime lacks sorts with en-US and warns once", async () => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = rows(["z", "ä"]);
    for (let i = 0; i < 3; i++) {
      const view = compute.computeViewIndex(data, column("text"), [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never, null, "tlh");
      expect(orderOf(data, view)).toEqual(["ä", "z"]);
    }
    expect(warn.mock.calls.filter(([m]) => String(m).includes("not supported"))).toHaveLength(1);
  });

  it("an invalid tag sorts with en-US and warns once", async () => {
    const { compute, cellTypes } = await loadUnderSwedishRuntime();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = rows(["z", "ä"]);
    for (let i = 0; i < 3; i++) {
      const view = compute.computeViewIndex(data, column("text"), [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never, null, "not a tag!");
      expect(orderOf(data, view)).toEqual(["ä", "z"]);
    }
    expect(warn.mock.calls.filter(([m]) => String(m).includes("sortLocale"))).toHaveLength(1);
  });
});

describe("sortLocale through the store", () => {
  const sortState = [{ columnId: "v", direction: "asc" }] as never;
  const base = (extra: object) => ({ data: ["z", "ä", "a"].map((v, i) => ({ id: String(i), v })), columns: column("text"), getRowId: (r: unknown) => (r as { id: string }).id, sortState, ...extra }) as never;

  it("the initial value and a later sync reach the view", async () => {
    const { createDataGridStore } = await import("./create-store");
    const { getInternalActions } = await import("./internal-actions");
    const { cellTypes } = await import("../cell-types/cell-types");
    const store = createDataGridStore(base({ cellTypes, sortLocale: "sv" }));
    const order = () => store.getState().viewIndex.map((i) => (store.getState().data[i] as { v: string }).v);
    expect(order()).toEqual(["a", "z", "ä"]);
    getInternalActions(store)._syncProps(base({ cellTypes, sortLocale: "en-US" }));
    expect(order()).toEqual(["a", "ä", "z"]);
  });

  it("a paged view sorts with the locale", async () => {
    const { createDataGridStore } = await import("./create-store");
    const { cellTypes } = await import("../cell-types/cell-types");
    const store = createDataGridStore(base({ cellTypes, sortLocale: "sv", paginationMode: "client", pageSize: 10 }));
    const state = store.getState();
    expect(state.viewIndex.map((i) => (state.data[i] as { v: string }).v)).toEqual(["a", "z", "ä"]);
  });

  const orderWith = async (extra: object) => {
    const { createDataGridStore } = await import("./create-store");
    const { cellTypes } = await import("../cell-types/cell-types");
    const store = createDataGridStore(base({ cellTypes, ...extra }));
    const order = () => store.getState().viewIndex.map((i) => (store.getState().data[i] as { v: string }).v);
    return { store, order };
  };

  it("the locale prop alone sets the sort language", async () => {
    expect((await orderWith({ locale: "sv" })).order()).toEqual(["a", "z", "ä"]);
  });

  it("an explicit sortLocale wins over the locale prop", async () => {
    expect((await orderWith({ locale: "sv", sortLocale: "en-US" })).order()).toEqual(["a", "ä", "z"]);
  });

  it("no locale props sort with en-US", async () => {
    expect((await orderWith({})).order()).toEqual(["a", "ä", "z"]);
  });

  it("a locale change rebuilds the view", async () => {
    const { getInternalActions } = await import("./internal-actions");
    const { cellTypes } = await import("../cell-types/cell-types");
    const { store, order } = await orderWith({ locale: "en-US" });
    getInternalActions(store)._syncProps(base({ cellTypes, locale: "sv" }));
    expect(order()).toEqual(["a", "z", "ä"]);
  });

  it("a text range filter follows the locale prop", async () => {
    const filterState = [{ columnId: "v", operator: "gt", value: "z" }];
    expect((await orderWith({ locale: "sv", filterState })).order()).toEqual(["ä"]);
    expect((await orderWith({ filterState })).order()).toEqual([]);
  });
});

describe("sort locale warnings and collator argument", () => {
  const stubbed = async () => {
    const { cellTypes } = await loadUnderSwedishRuntime();
    const { createDataGridStore } = await import("./create-store");
    const create = (extra: object) =>
      createDataGridStore({ data: [{ id: "0", v: "z" }], columns: column("text"), getRowId: (r: unknown) => (r as { id: string }).id, sortState: [{ columnId: "v", direction: "asc" }], cellTypes, ...extra } as never);
    return create;
  };

  it("names locale when the invalid tag came from the locale prop", async () => {
    const create = await stubbed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    create({ locale: "not a tag!!" });
    expect(warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("not a tag!!"))).toEqual([expect.stringMatching(/^\[data-grid\] locale "not a tag!!" is not a valid language tag/)]);
  });

  it("names sortLocale when the invalid tag came from sortLocale", async () => {
    const create = await stubbed();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    create({ locale: "sv", sortLocale: "not a tag!!" });
    expect(warn.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("not a tag!!"))).toEqual([expect.stringMatching(/^\[data-grid\] sortLocale "not a tag!!"/)]);
  });

  it("sortCollator(locale) ignores the scope", async () => {
    await loadUnderSwedishRuntime();
    const { sortCollator, withSortLocale } = await import("../sort-filter/sort-collator");
    expect(withSortLocale("en-US", () => sortCollator("sv").compare("ä", "z"))).toBeGreaterThan(0);
    expect(withSortLocale("sv", () => sortCollator("en-US").compare("ä", "z"))).toBeLessThan(0);
  });
});
