import { describe, expect, it } from "vitest";
import { serializeFilterState, parseFilterState } from "./filter-param";

describe("serializeFilterState / parseFilterState", () => {
  it("round-trips a single filter with a value", () => {
    const filters = [{ columnId: "age", operator: "gt" as const, value: "30" }];
    expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
  });

  it("round-trips a valueless operator (empty/notEmpty)", () => {
    const filters = [{ columnId: "name", operator: "empty" as const, value: undefined }];
    expect(serializeFilterState(filters)).toBe("name:empty:");
    expect(parseFilterState(serializeFilterState(filters))).toEqual([{ columnId: "name", operator: "empty", value: "" }]);
  });

  it("round-trips multiple filters, preserving order", () => {
    const filters = [
      { columnId: "age", operator: "gt" as const, value: "30" },
      { columnId: "name", operator: "contains" as const, value: "john" },
    ];
    expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
  });

  it("percent-encodes column id and value containing reserved characters", () => {
    const filters = [{ columnId: "a,b:c", operator: "equals" as const, value: "x:y,z" }];
    const encoded = serializeFilterState(filters);
    expect(parseFilterState(encoded)).toEqual(filters);
  });

  it("serializes an empty list to an empty string", () => {
    expect(serializeFilterState([])).toBe("");
  });

  it("parses an empty string to an empty list", () => {
    expect(parseFilterState("")).toEqual([]);
  });

  it("drops segments with an unknown operator", () => {
    expect(parseFilterState("age:banana:30")).toEqual([]);
  });

  it("drops segments with the wrong field count", () => {
    expect(parseFilterState("age:gt")).toEqual([]);
    expect(parseFilterState("age:gt:30:extra")).toEqual([]);
  });

  it("drops segments with an empty column id", () => {
    expect(parseFilterState(":gt:30")).toEqual([]);
  });

  it("keeps well-formed segments and drops malformed ones in the same string", () => {
    expect(parseFilterState("age:gt:30,garbage,name:contains:john")).toEqual([
      { columnId: "age", operator: "gt", value: "30" },
      { columnId: "name", operator: "contains", value: "john" },
    ]);
  });

  it("never throws on malformed percent-encoding", () => {
    expect(() => parseFilterState("age:gt:%E0%A4%A")).not.toThrow();
    expect(parseFilterState("age:gt:%E0%A4%A")).toEqual([]);
  });

  it("ignores arbitrary garbage input", () => {
    expect(parseFilterState("!!!not-valid!!!")).toEqual([]);
  });

  describe("isBetween (two-value range)", () => {
    it("round-trips both bounds", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["10", "30"] as [string, string] }];
      expect(serializeFilterState(filters)).toBe("age:isBetween:10~30");
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("round-trips an open-ended range (one bound blank)", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["", "30"] as [string, string] }];
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("percent-encodes each side of the range independently", () => {
      const filters = [{ columnId: "age", operator: "isBetween" as const, value: ["a~b", "c,d:e"] as [string, string] }];
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("drops a malformed range (wrong arity)", () => {
      expect(parseFilterState("age:isBetween:10")).toEqual([]);
      expect(parseFilterState("age:isBetween:10~20~30")).toEqual([]);
    });

    it("round-trips alongside plain-value filters in the same list", () => {
      const filters = [
        { columnId: "age", operator: "isBetween" as const, value: ["10", "30"] as [string, string] },
        { columnId: "name", operator: "contains" as const, value: "john" },
      ];
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });
  });

  describe("isAnyOf (multi-choice list)", () => {
    it("round-trips a choice list", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: ["new", "open"] }];
      expect(serializeFilterState(filters)).toBe("status:isAnyOf:new|open");
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("percent-encodes each choice, so a literal separator or reserved character in a choice never collides", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: ["a|b", "c:d", "e,f"] }];
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("round-trips an empty choice list (matches nothing) as an empty value", () => {
      const filters = [{ columnId: "status", operator: "isAnyOf" as const, value: [] }];
      expect(serializeFilterState(filters)).toBe("status:isAnyOf:");
      expect(parseFilterState(serializeFilterState(filters))).toEqual(filters);
    });

    it("drops a choice list with malformed percent-encoding", () => {
      expect(parseFilterState("status:isAnyOf:new|%E0%A4%A")).toEqual([]);
    });
  });

  it("a URL generated before isBetween existed still parses every other operator unchanged", () => {
    // pre-existing 3-field columnId:operator:value format, untouched by the isBetween extension.
    expect(parseFilterState("age:gt:30,name:contains:john")).toEqual([
      { columnId: "age", operator: "gt", value: "30" },
      { columnId: "name", operator: "contains", value: "john" },
    ]);
  });
});
