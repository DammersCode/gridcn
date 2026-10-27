import { describe, expect, it } from "vitest";
import type { ColumnLayout } from "@/registry/default/blocks/data-grid/data-grid";
import {
  MAX_URL_LAYOUT_COLUMNS,
  MAX_URL_LAYOUT_PARAM_LENGTH,
  parseLayoutPart,
  serializeLayoutPart,
  type UrlLayoutPart,
} from "./layout-param";

const layout: ColumnLayout = {
  widths: { name: 240, "a,b": 80 },
  order: ["age", "name", "a,b"],
  pins: { name: "left", age: "right" },
  hidden: ["age"],
};

describe("layout param codec", () => {
  it("round trips every part", () => {
    expect(parseLayoutPart("order", serializeLayoutPart("order", layout))).toEqual({ order: layout.order });
    expect(parseLayoutPart("hidden", serializeLayoutPart("hidden", layout))).toEqual({ hidden: layout.hidden });
    expect(parseLayoutPart("widths", serializeLayoutPart("widths", layout))).toEqual({ widths: layout.widths });
    expect(parseLayoutPart("pins", serializeLayoutPart("pins", layout))).toEqual({ pins: layout.pins });
  });

  it("writes start/end pin codes and reads the legacy left/right codes", () => {
    expect(serializeLayoutPart("pins", layout)).toBe("name:s,age:e");
    expect(parseLayoutPart("pins", "name:l,age:r")).toEqual({ pins: { name: "left", age: "right" } });
  });

  it("percent-encodes ids that contain separators", () => {
    expect(serializeLayoutPart("order", { ...layout, order: ["a,b", "c:d"] })).toBe("a%2Cb,c%3Ad");
  });

  it("writes and reads the none value for empty hidden and pins", () => {
    expect(serializeLayoutPart("hidden", { ...layout, hidden: [] })).toBe("-");
    expect(serializeLayoutPart("pins", { ...layout, pins: {} })).toBe("-");
    expect(parseLayoutPart("hidden", "-")).toEqual({ hidden: [] });
    expect(parseLayoutPart("pins", "-")).toEqual({ pins: {} });
  });

  it("keeps a column whose id is the none value distinct from it", () => {
    const raw = serializeLayoutPart("hidden", { ...layout, hidden: ["-"] });
    expect(raw).not.toBe("-");
    expect(parseLayoutPart("hidden", raw)).toEqual({ hidden: ["-"] });
  });

  it("reads an empty param as no part", () => {
    for (const part of ["order", "hidden", "widths", "pins"] as const) expect(parseLayoutPart(part, "")).toEqual({});
  });

  it("drops undecodable, empty, and duplicate ids (first wins)", () => {
    expect(parseLayoutPart("order", "a,%E0%A4%A,,b,a")).toEqual({ order: ["a", "b"] });
    expect(parseLayoutPart("widths", "a:100,a:200")).toEqual({ widths: { a: 100 } });
    expect(parseLayoutPart("pins", "a:l,a:r")).toEqual({ pins: { a: "left" } });
  });

  it("drops bad widths", () => {
    const raw = "a:-5,b:1e9,c:abc,d:123456,e:,f,g:1:2,h:80";
    expect(parseLayoutPart("widths", raw)).toEqual({ widths: { h: 80 } });
  });

  it("drops bad pins", () => {
    expect(parseLayoutPart("pins", "a:x,b:left,c:l,d:r,e:s,f:e")).toEqual({ pins: { c: "left", d: "right", e: "left", f: "right" } });
  });

  it("ignores a param over the length cap", () => {
    const raw = "a,".repeat(MAX_URL_LAYOUT_PARAM_LENGTH);
    expect(parseLayoutPart("order", raw)).toEqual({});
  });

  it("reads at most the segment cap", () => {
    const raw = Array.from({ length: MAX_URL_LAYOUT_COLUMNS + 1 }, (_, i) => `c${i}`).join(",");
    expect(raw.length).toBeLessThanOrEqual(MAX_URL_LAYOUT_PARAM_LENGTH);
    const order = parseLayoutPart("order", raw).order ?? [];
    expect(order).toHaveLength(MAX_URL_LAYOUT_COLUMNS);
    expect(order.at(-1)).toBe(`c${MAX_URL_LAYOUT_COLUMNS - 1}`);
  });

  it("keeps prototype-named ids as plain own entries", () => {
    const widths = parseLayoutPart("widths", "__proto__:90,constructor:70").widths ?? {};
    expect(Object.keys(widths)).toEqual(["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(widths)).toBe(Object.prototype);
  });

  it("never throws on hostile input", () => {
    const hostile = ["%", "%%%%", ":", ",,,,", "a:", ":l", "\0", "%00,%ff", "a:99999999999999999999", "a".repeat(16_384)];
    for (const part of ["order", "hidden", "widths", "pins"] as const) {
      for (const raw of hostile) expect(() => parseLayoutPart(part, raw)).not.toThrow();
    }
  });
});

describe("layout param performance", () => {
  const CI_FACTOR = process.env["CI"] ? 2 : 1;
  const BUDGET_MS = 10;

  // Three maximum-size parses per run; ~5x the measured 0.8-1.7 ms (x CI_FACTOR on CI).
  it("parses maximum-size params in linear time", () => {
    const widthsRaw = Array.from({ length: MAX_URL_LAYOUT_COLUMNS }, (_, i) => `c${i}:1${String(i % 100).padStart(2, "0")}`).join(",");
    const orderRaw = Array.from({ length: MAX_URL_LAYOUT_COLUMNS }, (_, i) => `c${i}`).join(",");
    const hostile = "%".repeat(MAX_URL_LAYOUT_PARAM_LENGTH);
    const parseAll = () => {
      parseLayoutPart("widths", widthsRaw);
      parseLayoutPart("order", orderRaw);
      parseLayoutPart("hidden", hostile);
    };
    for (let i = 0; i < 20; i++) parseAll();
    const runs = 50;
    const start = performance.now();
    for (let i = 0; i < runs; i++) parseAll();
    const perRun = (performance.now() - start) / runs;
    expect(perRun).toBeLessThan(BUDGET_MS * CI_FACTOR);
  });

  it("treats an unknown part as empty instead of throwing", () => {
    expect(parseLayoutPart("bogus" as UrlLayoutPart, "a,b")).toEqual({});
  });
});
