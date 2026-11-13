import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyColumnDef } from "./types";

const RealCollator = Intl.Collator;
const realLocaleCompare = String.prototype.localeCompare;

type Compute = typeof import("./compute");
type CellTypesModule = typeof import("../cell-types/cell-types");

async function loadUnderSwedishRuntime(): Promise<{ compute: Compute; cellTypes: CellTypesModule["cellTypes"] }> {
  vi.stubGlobal("Intl", {
    ...Intl,
    Collator: function (locale?: string | string[], options?: Intl.CollatorOptions) {
      return new RealCollator(locale ?? "sv", options);
    },
  });
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
