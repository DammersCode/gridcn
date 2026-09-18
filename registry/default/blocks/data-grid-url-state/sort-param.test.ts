import { describe, expect, it } from "vitest";
import { serializeSortState, parseSortState } from "./sort-param";

describe("serializeSortState / parseSortState", () => {
  it("round-trips a single sort", () => {
    const sorts = [{ columnId: "name", direction: "asc" as const }];
    expect(parseSortState(serializeSortState(sorts))).toEqual(sorts);
  });

  it("round-trips a multi-column sort, preserving order", () => {
    const sorts = [
      { columnId: "name", direction: "asc" as const },
      { columnId: "age", direction: "desc" as const },
    ];
    expect(serializeSortState(sorts)).toBe("name:asc,age:desc");
    expect(parseSortState(serializeSortState(sorts))).toEqual(sorts);
  });

  it("percent-encodes column ids containing reserved characters", () => {
    const sorts = [{ columnId: "a,b:c", direction: "asc" as const }];
    const encoded = serializeSortState(sorts);
    expect(encoded).not.toContain(",b");
    expect(parseSortState(encoded)).toEqual(sorts);
  });

  it("serializes an empty list to an empty string", () => {
    expect(serializeSortState([])).toBe("");
  });

  it("parses an empty string to an empty list", () => {
    expect(parseSortState("")).toEqual([]);
  });

  it("drops segments with an invalid direction", () => {
    expect(parseSortState("name:sideways")).toEqual([]);
  });

  it("drops segments missing a direction entirely", () => {
    expect(parseSortState("name")).toEqual([]);
  });

  it("drops segments with an empty column id", () => {
    expect(parseSortState(":asc")).toEqual([]);
  });

  it("keeps well-formed segments and drops malformed ones in the same string", () => {
    expect(parseSortState("name:asc,garbage,age:desc")).toEqual([
      { columnId: "name", direction: "asc" },
      { columnId: "age", direction: "desc" },
    ]);
  });

  it("never throws on malformed percent-encoding", () => {
    expect(() => parseSortState("%E0%A4%A:asc")).not.toThrow();
    expect(parseSortState("%E0%A4%A:asc")).toEqual([]);
  });

  it("ignores arbitrary garbage input", () => {
    expect(parseSortState("!!!not-valid!!!")).toEqual([]);
  });
});
