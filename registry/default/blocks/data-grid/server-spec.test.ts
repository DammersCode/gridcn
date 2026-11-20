import { describe, expect, it } from "vitest";
import { EMPTY_SERVER_SPEC, serverSpecKey, type ServerSpec } from "./server-spec";

describe("serverSpecKey", () => {
  it("ignores the generated filterId", () => {
    const a: ServerSpec = { sorts: [], filters: [{ filterId: "a1", columnId: "x", operator: "contains", value: "q" }], searchText: "" };
    const b: ServerSpec = { ...a, filters: [{ filterId: "b2", columnId: "x", operator: "contains", value: "q" }] };
    expect(serverSpecKey(a)).toBe(serverSpecKey(b));
  });

  it("tells a negated group from a plain one and ignores not false", () => {
    const filters = (not?: boolean): ServerSpec["filters"] => [{ join: "and", ...(not === undefined ? null : { not }), filters: [{ columnId: "x", operator: "equals", value: "q" }] }];
    const spec = (not?: boolean): ServerSpec => ({ sorts: [], filters: filters(not), searchText: "" });
    expect(serverSpecKey(spec(true))).not.toBe(serverSpecKey(spec()));
    expect(serverSpecKey(spec(false))).toBe(serverSpecKey(spec()));
  });

  it("differs when the search text differs", () => {
    expect(serverSpecKey({ ...EMPTY_SERVER_SPEC, searchText: "a" })).not.toBe(serverSpecKey(EMPTY_SERVER_SPEC));
  });
});

describe("serverSpecKey with groups", () => {
  it("keeps the key of an ungrouped spec byte-equal to the spec of today", () => {
    const today = JSON.stringify({ sorts: [], filters: [], searchText: "" });
    expect(serverSpecKey(EMPTY_SERVER_SPEC)).toBe(today);
    expect(serverSpecKey({ ...EMPTY_SERVER_SPEC, groupBy: [], aggregates: [] })).toBe(today);
  });

  it("differs when the group columns or the aggregates differ", () => {
    const grouped: ServerSpec = { ...EMPTY_SERVER_SPEC, groupBy: ["region"] };
    expect(serverSpecKey(grouped)).not.toBe(serverSpecKey(EMPTY_SERVER_SPEC));
    expect(serverSpecKey({ ...grouped, groupBy: ["region", "team"] })).not.toBe(serverSpecKey(grouped));
    expect(serverSpecKey({ ...grouped, aggregates: [{ columnId: "qty", reducer: "sum" }] })).not.toBe(serverSpecKey(grouped));
  });
});

describe("serverSpecKey with pivot", () => {
  const grouped: ServerSpec = { ...EMPTY_SERVER_SPEC, groupBy: ["region"], aggregates: [{ columnId: "qty", reducer: "sum" }] };

  it("keeps the key of a spec without pivot byte-equal", () => {
    expect(serverSpecKey(grouped)).toBe('{"sorts":[],"filters":[],"searchText":"","groupBy":["region"],"aggregates":[{"columnId":"qty","reducer":"sum"}]}');
  });

  it("differs when the spec has a pivot", () => {
    expect(serverSpecKey({ ...grouped, pivot: { columnIds: ["year"] } })).not.toBe(serverSpecKey(grouped));
  });
});
