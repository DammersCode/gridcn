import { describe, expect, it } from "vitest";
import { EMPTY_SERVER_SPEC, serverSpecKey, type ServerSpec } from "./server-spec";

describe("serverSpecKey", () => {
  it("ignores the generated filterId", () => {
    const a: ServerSpec = { sorts: [], filters: [{ filterId: "a1", columnId: "x", operator: "contains", value: "q" }], searchText: "" };
    const b: ServerSpec = { ...a, filters: [{ filterId: "b2", columnId: "x", operator: "contains", value: "q" }] };
    expect(serverSpecKey(a)).toBe(serverSpecKey(b));
  });

  it("differs when the search text differs", () => {
    expect(serverSpecKey({ ...EMPTY_SERVER_SPEC, searchText: "a" })).not.toBe(serverSpecKey(EMPTY_SERVER_SPEC));
  });
});
