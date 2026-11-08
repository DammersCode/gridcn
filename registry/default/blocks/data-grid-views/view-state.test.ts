import { describe, expect, it } from "vitest";
import {
  MAX_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  captureViewState,
  parseViewDocument,
  parseViewFile,
  sanitizeViewState,
  serializeViewFile,
  viewStateKey,
  type DataGridViewState,
  type ViewColumns,
} from "./view-state";

const columns: ViewColumns = new Map([
  ["name", {}],
  ["age", {}],
  ["secret", { sortable: false, filterable: false }],
]);

const state: DataGridViewState = {
  sorts: [{ columnId: "age", direction: "desc" }],
  filters: [{ columnId: "name", operator: "contains", value: "a" }],
  searchText: "bob",
  searchOptions: { matchCase: false, wholeCell: false },
  columnLayout: { widths: { name: 120 }, order: ["age", "name", "secret"], pins: { name: "left" }, hidden: ["secret"] },
};

describe("captureViewState", () => {
  it("strips transient filter ids from nested groups", () => {
    const captured = captureViewState({
      ...state,
      filters: [{ filterId: "f1", join: "or", filters: [{ filterId: "f2", columnId: "name", operator: "equals", value: "x" }] }],
    });
    expect(captured.filters).toEqual([{ join: "or", filters: [{ columnId: "name", operator: "equals", value: "x" }] }]);
  });
});

describe("viewStateKey", () => {
  it("ignores object key order and filter ids", () => {
    const a = { ...state, columnLayout: { ...state.columnLayout, widths: { name: 1, age: 2 } } };
    const b = { ...state, columnLayout: { ...state.columnLayout, widths: { age: 2, name: 1 } } };
    expect(viewStateKey(a)).toBe(viewStateKey(b));
  });

  it("changes when a part changes", () => {
    expect(viewStateKey(state)).not.toBe(viewStateKey({ ...state, searchText: "other" }));
  });
});

describe("sanitizeViewState", () => {
  it("keeps a valid state unchanged", () => {
    const result = sanitizeViewState(state, columns);
    expect(result.state).toEqual({ ...state, sorts: state.sorts, columnLayout: state.columnLayout });
    expect(result.dropped).toBe(0);
  });

  it("drops entries for removed columns and counts them", () => {
    const result = sanitizeViewState(
      {
        ...state,
        sorts: [{ columnId: "gone", direction: "asc" }, { columnId: "age", direction: "asc" }],
        filters: [{ columnId: "gone", operator: "equals", value: "x" }],
        columnLayout: { widths: { gone: 10 }, order: ["gone", "name"], pins: { gone: "left" }, hidden: ["gone"] },
      },
      columns,
    );
    expect(result.state.sorts).toEqual([{ columnId: "age", direction: "asc" }]);
    expect(result.state.filters).toEqual([]);
    expect(result.state.columnLayout).toEqual({ widths: {}, order: ["name"], pins: {}, hidden: [] });
    expect(result.dropped).toBe(6);
  });

  it("keeps a custom operator only when the column registers it, with a value of its input shape", () => {
    const withOperators: ViewColumns = new Map([
      ["name", { operators: new Map<string, "single" | "range" | "list" | "none">([["inRegion", "single"], ["inSpan", "range"], ["inAny", "list"], ["isSet", "none"]]) }],
    ]);
    const result = sanitizeViewState(
      {
        ...state,
        filters: [
          { columnId: "name", operator: "inRegion", value: "EU" },
          { columnId: "name", operator: "inSpan", value: ["1", "2"] },
          { columnId: "name", operator: "inAny", value: ["a", "b"] },
          { columnId: "name", operator: "isSet" },
          { columnId: "name", operator: "inRegion", value: ["EU"] },
          { columnId: "name", operator: "inSpan", value: "1" },
          { columnId: "name", operator: "dropAll", value: "x" },
        ],
      },
      withOperators,
    );
    expect(result.state.filters).toEqual([
      { columnId: "name", operator: "inRegion", value: "EU" },
      { columnId: "name", operator: "inSpan", value: ["1", "2"] },
      { columnId: "name", operator: "inAny", value: ["a", "b"] },
      { columnId: "name", operator: "isSet" },
    ]);
  });

  it("drops sorts and filters on columns that opt out", () => {
    const result = sanitizeViewState(
      { ...state, sorts: [{ columnId: "secret", direction: "asc" }], filters: [{ columnId: "secret", operator: "equals", value: "x" }] },
      columns,
    );
    expect(result.state.sorts).toEqual([]);
    expect(result.state.filters).toEqual([]);
  });

  it("drops unknown operators, wrong value shapes, and non-objects", () => {
    const result = sanitizeViewState(
      {
        ...state,
        filters: [
          { columnId: "name", operator: "drop table", value: "x" },
          { columnId: "name", operator: "isBetween", value: "x" },
          { columnId: "name", operator: "isAnyOf", value: "x" },
          { columnId: "name", operator: "equals", value: { a: 1 } },
          null,
          "str",
          { columnId: "name", operator: "isBetween", value: ["1", "2"] },
          { columnId: "name", operator: "empty" },
        ],
      },
      columns,
    );
    expect(result.state.filters).toEqual([
      { columnId: "name", operator: "isBetween", value: ["1", "2"] },
      { columnId: "name", operator: "empty" },
    ]);
    expect(result.dropped).toBe(6);
  });

  it("keeps groups, drops empty groups and groups nested past the depth limit", () => {
    const leaf = { columnId: "name", operator: "equals", value: "x" };
    const result = sanitizeViewState(
      {
        ...state,
        filters: [
          { join: "or", filters: [leaf, { join: "and", filters: [leaf, { join: "or", filters: [leaf] }] }] },
          { join: "and", filters: [] },
          { join: "xor", filters: [leaf] },
        ],
      },
      columns,
    );
    expect(result.state.filters).toEqual([{ join: "or", filters: [leaf, { join: "and", filters: [leaf] }] }]);
  });

  it("bounds the filter count, list size, and string length", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ columnId: "name", operator: "equals", value: String(i) }));
    const result = sanitizeViewState(
      {
        ...state,
        filters: [...many, { columnId: "name", operator: "isAnyOf", value: Array.from({ length: 2000 }, (_, i) => String(i)) }],
        searchText: "x".repeat(5000),
      },
      columns,
    );
    expect(result.state.filters.length).toBeLessThanOrEqual(64);
    expect(result.state.searchText.length).toBeLessThanOrEqual(500);
  });

  it("drops an isNoneOf filter over its value bound instead of narrowing it", () => {
    const result = sanitizeViewState(
      { ...state, filters: [{ columnId: "name", operator: "isNoneOf", value: Array.from({ length: 2000 }, (_, i) => String(i)) }] },
      columns,
    );
    expect(result.state.filters).toEqual([]);
  });

  it("does not let a prototype key reach the layout", () => {
    const hostile = JSON.parse('{"widths":{"__proto__":10,"name":120},"order":[],"pins":{"__proto__":"left"},"hidden":[]}');
    const result = sanitizeViewState({ ...state, columnLayout: hostile }, columns);
    expect(Object.keys(result.state.columnLayout.widths)).toEqual(["name"]);
    expect(Object.keys(result.state.columnLayout.pins)).toEqual([]);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("rejects bad widths, pins, and directions", () => {
    const result = sanitizeViewState(
      {
        ...state,
        sorts: [{ columnId: "age", direction: "sideways" }],
        columnLayout: { widths: { name: -5, age: Number.NaN }, order: [], pins: { name: "middle" }, hidden: [] },
      },
      columns,
    );
    expect(result.state.sorts).toEqual([]);
    expect(result.state.columnLayout.widths).toEqual({});
    expect(result.state.columnLayout.pins).toEqual({});
  });

  it("deduplicates order and hidden and bounds sorts", () => {
    const result = sanitizeViewState(
      {
        ...state,
        sorts: [{ columnId: "age", direction: "asc" }, { columnId: "age", direction: "desc" }],
        columnLayout: { widths: {}, order: ["name", "name", "age"], pins: {}, hidden: ["age", "age"] },
      },
      columns,
    );
    expect(result.state.sorts).toEqual([{ columnId: "age", direction: "asc" }]);
    expect(result.state.columnLayout.order).toEqual(["name", "age"]);
    expect(result.state.columnLayout.hidden).toEqual(["age"]);
  });

  it("falls back to an empty state for a non-object", () => {
    expect(sanitizeViewState("nope", columns).state).toEqual({
      sorts: [],
      filters: [],
      searchText: "",
      searchOptions: { matchCase: false, wholeCell: false },
      columnLayout: { widths: {}, order: [], pins: {}, hidden: [] },
    });
  });

  it("keeps every column id when no columns are given", () => {
    expect(sanitizeViewState(state, undefined).state.sorts).toEqual(state.sorts);
    expect(sanitizeViewState({ ...state, sorts: [{ columnId: "gone", direction: "asc" }] }, undefined).state.sorts).toHaveLength(1);
  });
});

describe("parseViewDocument", () => {
  const valid = { version: 1, defaultViewId: "a", views: [{ id: "a", name: "First", state }] };

  it("accepts a valid document", () => {
    expect(parseViewDocument(valid)).toEqual({ version: 1, defaultViewId: "a", views: [{ id: "a", name: "First", state }] });
  });

  it("returns null for anything that is not a version 1 document", () => {
    for (const bad of [null, 5, "x", [], { version: 2, views: [] }, { version: 1, views: "no" }]) {
      expect(parseViewDocument(bad)).toBeNull();
    }
  });

  it("drops duplicate ids, blank names, and a default id that names no view", () => {
    const result = parseViewDocument({
      version: 1,
      defaultViewId: "zzz",
      views: [{ id: "a", name: " ", state }, { id: "b", name: "B", state }, { id: "b", name: "B2", state }, { id: 7, name: "N", state }],
    });
    expect(result!.views.map((v) => v.id)).toEqual(["b"]);
    expect(result!.defaultViewId).toBeNull();
  });

  it("caps the view count and the name length", () => {
    const views = Array.from({ length: MAX_VIEWS + 20 }, (_, i) => ({ id: `v${i}`, name: "n".repeat(MAX_VIEW_NAME_LENGTH + 40), state }));
    const result = parseViewDocument({ version: 1, defaultViewId: null, views });
    expect(result!.views).toHaveLength(MAX_VIEWS);
    expect(result!.views[0]!.name).toHaveLength(MAX_VIEW_NAME_LENGTH);
  });
});

describe("view files", () => {
  it("round-trips through serialize and parse", () => {
    const text = serializeViewFile({ name: "First", state });
    const parsed = parseViewFile(text, columns);
    expect(parsed).toEqual({ ok: true, name: "First", state, dropped: 0 });
  });

  it("rejects oversize, malformed, and foreign JSON", () => {
    expect(parseViewFile("x".repeat(200_000), columns)).toEqual({ ok: false, reason: "too-large" });
    expect(parseViewFile("{not json", columns)).toEqual({ ok: false, reason: "invalid" });
    expect(parseViewFile(JSON.stringify({ format: "other", version: 1 }), columns)).toEqual({ ok: false, reason: "invalid" });
    expect(parseViewFile(JSON.stringify([1, 2]), columns)).toEqual({ ok: false, reason: "invalid" });
  });

  it("validates a file against the live columns and reports drops", () => {
    const text = serializeViewFile({ name: "First", state: { ...state, sorts: [{ columnId: "gone", direction: "asc" }] } });
    const parsed = parseViewFile(text, columns);
    expect(parsed.ok && parsed.dropped).toBe(1);
  });

  it("drops sorts and filters on columns the imported layout hides", () => {
    const text = serializeViewFile({
      name: "Hidden",
      state: { ...state, sorts: [{ columnId: "secret", direction: "asc" }, { columnId: "age", direction: "asc" }], filters: [{ columnId: "secret", operator: "equals", value: "x" }, { columnId: "name", operator: "equals", value: "a" }] },
    });
    const parsed = parseViewFile(text, new Map([["name", {}], ["age", {}], ["secret", {}]]));
    expect(parsed).toMatchObject({ ok: true, dropped: 2 });
    expect(parsed.ok && parsed.state.sorts).toEqual([{ columnId: "age", direction: "asc" }]);
    expect(parsed.ok && parsed.state.filters).toEqual([{ columnId: "name", operator: "equals", value: "a" }]);
  });

  it("counts entries cut by a list limit", () => {
    const sorts = Array.from({ length: 1200 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" }));
    expect(sanitizeViewState({ ...state, sorts }, undefined).dropped).toBeGreaterThanOrEqual(200);
  });

  it("caps an isAnyOf list at 1000 entries", () => {
    const value = Array.from({ length: 1500 }, (_, i) => String(i));
    const result = sanitizeViewState({ ...state, filters: [{ columnId: "name", operator: "isAnyOf", value }] }, columns);
    expect((result.state.filters[0] as { value: string[] }).value).toHaveLength(1000);
  });

  it("reads a nameless file with an empty name", () => {
    const text = JSON.stringify({ format: "gridcn-view", version: 1, state });
    expect(parseViewFile(text, columns)).toMatchObject({ ok: true, name: "" });
  });
});
