import { describe, expect, it } from "vitest";
import type { FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import {
  MAX_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  captureViewState,
  overLimitPart,
  savableViewState,
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
  ["secret", { sortable: false, filterable: false, groupable: false }],
]);

const state: DataGridViewState = {
  groupBy: ["name"],
  sorts: [{ columnId: "age", direction: "desc" }],
  filters: [{ columnId: "name", operator: "contains", value: "a" }],
  searchText: "bob",
  searchOptions: { matchCase: false, wholeCell: false },
  columnLayout: { widths: { name: 120 }, order: ["age", "name", "secret"], pins: { name: "start" }, hidden: ["secret"] },
};

describe("filterJoin", () => {
  it("keeps or and leaves and out of a capture", () => {
    expect(captureViewState({ ...state, filterJoin: "or" }).filterJoin).toBe("or");
    expect("filterJoin" in captureViewState({ ...state, filterJoin: "and" })).toBe(false);
  });

  it("tells an or view from an and view", () => {
    expect(viewStateKey({ ...state, filterJoin: "or" })).not.toBe(viewStateKey(state));
    expect(viewStateKey({ ...state, filterJoin: "and" })).toBe(viewStateKey(state));
  });

  it("sanitizes untrusted values to or or nothing", () => {
    expect(sanitizeViewState({ ...state, filterJoin: "or" }, columns).state.filterJoin).toBe("or");
    for (const bad of ["and", "OR", 1, null, {}, "xor"]) expect("filterJoin" in sanitizeViewState({ ...state, filterJoin: bad }, columns).state).toBe(false);
  });

  it("survives a file round trip and a stored document", () => {
    const view = { name: "x", state: { ...state, filterJoin: "or" as const } };
    expect(parseViewFile(serializeViewFile(view), columns)).toMatchObject({ ok: true, state: { filterJoin: "or" } });
    expect(parseViewDocument({ version: 1, defaultViewId: null, views: [{ id: "a", name: "x", state: view.state }] })?.views[0]!.state.filterJoin).toBe("or");
  });
});

describe("group not", () => {
  const leafOf = (value: string): FilterSpec => ({ columnId: "name", operator: "equals", value });
  const group = (extra: Record<string, unknown>) => ({ ...state, filters: [{ join: "and", filters: [leafOf("a")], ...extra }] });

  it("keeps not only as true through a capture", () => {
    expect(captureViewState(group({ filterId: "g", not: true }) as never).filters[0]).toEqual({ join: "and", not: true, filters: [leafOf("a")] });
    expect("not" in captureViewState(group({ not: false }) as never).filters[0]!).toBe(false);
  });

  it("tells a negated view from a plain one", () => {
    expect(viewStateKey(group({ not: true }) as never)).not.toBe(viewStateKey(group({}) as never));
  });

  it("sanitizes not to true or nothing", () => {
    expect(sanitizeViewState(group({ not: true }), columns).state.filters[0]).toMatchObject({ not: true });
    for (const bad of [false, "true", 1, null]) expect("not" in sanitizeViewState(group({ not: bad }), columns).state.filters[0]!).toBe(false);
  });

  it("drops a negated group that lost a child, and keeps a plain one", () => {
    const lost = (extra: Record<string, unknown>) => ({ ...state, filters: [{ join: "and", ...extra, filters: [leafOf("a"), { columnId: "no-such-column", operator: "equals", value: "b" }] }] });
    expect(sanitizeViewState(lost({ not: true }), columns)).toMatchObject({ state: { filters: [] }, dropped: 2 });
    expect(sanitizeViewState(lost({}), columns).state.filters).toHaveLength(1);
  });
});

describe("view file with a hidden column in a negated group", () => {
  const open: ViewColumns = new Map([["name", {}], ["secret", {}]]);
  const file = (not: boolean) =>
    serializeViewFile({ name: "x", state: { ...state, columnLayout: { ...state.columnLayout, hidden: ["secret"] }, filters: [{ join: "and", ...(not ? { not } : null), filters: [{ columnId: "name", operator: "equals", value: "a" }, { columnId: "secret", operator: "equals", value: "b" }] }] } });
  it("drops the negated group whole and keeps a plain group with fewer terms", () => {
    expect(parseViewFile(file(true), open)).toMatchObject({ ok: true, state: { filters: [] } });
    expect(parseViewFile(file(false), open)).toMatchObject({ ok: true, state: { filters: [{ join: "and", filters: [{ columnId: "name" }] }] } });
  });
});

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
  it("reads saved left and right pins as start and end", () => {
    const legacy = { ...state, columnLayout: { ...state.columnLayout, pins: { name: "left", age: "right" } } };
    expect(sanitizeViewState(legacy, columns).state.columnLayout?.pins).toEqual({ name: "start", age: "end" });
  });

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
        columnLayout: { widths: { gone: 10 }, order: ["gone", "name"], pins: { gone: "start" }, hidden: ["gone"] },
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
    const hostile = JSON.parse('{"widths":{"__proto__":10,"name":120},"order":[],"pins":{"__proto__":"start"},"hidden":[]}');
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
      groupBy: [],
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

describe("a long column id", () => {
  const long = "c".repeat(300);
  const empty = { sorts: [], groupBy: [], filters: [], searchText: "", searchOptions: { matchCase: false, wholeCell: false }, columnLayout: { widths: {}, order: [], pins: {}, hidden: [] } } as DataGridViewState;
  it.each([
    ["a sort", { sorts: [{ columnId: long, direction: "asc" }] }],
    ["a nested filter", { filters: [{ join: "and", filters: [{ columnId: long, operator: "contains", value: "a" }] }] }],
    ["a width", { columnLayout: { widths: { [long]: 100 }, order: [], pins: {}, hidden: [] } }],
    ["a pin", { columnLayout: { widths: {}, order: [], pins: { [long]: "start" }, hidden: [] } }],
    ["the order", { columnLayout: { widths: {}, order: [long], pins: {}, hidden: [] } }],
    ["the hidden list", { columnLayout: { widths: {}, order: [], pins: {}, hidden: [long] } }],
  ])("is not over a limit for %s", (_name, change) => {
    const state = { ...empty, ...change } as DataGridViewState;
    expect(overLimitPart(state)).toBe(false);
    expect(savableViewState(state)).not.toBeNull();
  });
  it("survives save then reload of a stored document", () => {
    const state = {
      groupBy: [],
      sorts: [{ columnId: long, direction: "desc" }],
      filters: [{ join: "and", filters: [{ columnId: long, operator: "contains", value: "a" }] }],
      searchText: "",
      searchOptions: { matchCase: false, wholeCell: false },
      columnLayout: { widths: { [long]: 120 }, order: [long], pins: { [long]: "start" }, hidden: [long] },
    } as DataGridViewState;
    const stored = JSON.parse(JSON.stringify({ version: 1, defaultViewId: null, views: [{ id: "v", name: "Long", state: savableViewState(state) }] }));
    expect(parseViewDocument(stored)!.views[0]!.state).toEqual(state);
  });
  it("is kept by a file import only for a live column", () => {
    const state = { ...empty, sorts: [{ columnId: long, direction: "asc" }] } as DataGridViewState;
    const text = serializeViewFile({ name: "n", state });
    expect(parseViewFile(text, new Map([[long, {}]]))).toMatchObject({ ok: true, dropped: 0, state: { sorts: [{ columnId: long }] } });
    expect(parseViewFile(text, new Map([["a", {}]]))).toMatchObject({ ok: true, dropped: 1, state: { sorts: [] } });
  });
  it("is not over a limit for a custom operator id of any length", () => {
    const filters = [{ columnId: "a", operator: "op".repeat(40), value: "q" }];
    expect(overLimitPart({ ...empty, filters })).toBe(false);
    expect(savableViewState({ ...empty, filters })).not.toBeNull();
  });
  it("saves a column named __proto__ without touching the prototype", () => {
    const sorts = [{ columnId: "__proto__", direction: "asc" as const }];
    expect(overLimitPart({ ...empty, sorts })).toBe(false);
    expect(savableViewState({ ...empty, sorts })?.sorts).toEqual(sorts);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
  it("is not over a limit for a filter without a value on a scalar operator", () => {
    const filters = [{ columnId: "a", operator: "equals" }] as DataGridViewState["filters"];
    expect(overLimitPart({ ...empty, filters })).toBe(false);
    expect(savableViewState({ ...empty, filters })?.filters).toEqual(filters);
  });
  it.each([
    ["a list on contains", { columnId: "a", operator: "contains", value: ["x"] }],
    ["a list on startsWith", { columnId: "a", operator: "startsWith", value: ["x"] }],
  ])("reports %s as over the filters limit", (_name, filter) => {
    expect(overLimitPart({ ...empty, filters: [filter] } as DataGridViewState)).toBe("filters");
  });
  it("is still reported for a part over a real limit", () => {
    const sorts = Array.from({ length: 65 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }));
    expect(overLimitPart({ ...empty, sorts })).toBe("sorts");
  });
  it("saves 64 sorts", () => {
    const sorts = Array.from({ length: 64 }, (_, i) => ({ columnId: `c${i}`, direction: "asc" as const }));
    expect(overLimitPart({ ...empty, sorts })).toBe(false);
  });
});

describe("groupBy in a view", () => {
  const live = new Map<string, { groupable?: boolean }>([["name", {}], ["age", {}], ["secret", { groupable: false }]]);

  it("changes the state key", () => {
    expect(viewStateKey(state)).not.toBe(viewStateKey({ ...state, groupBy: [] }));
  });

  it("reads a stored view without the field as no group", () => {
    const { groupBy: _omitted, ...stored } = state;
    expect(sanitizeViewState(stored, live).state.groupBy).toEqual([]);
  });

  it("drops unknown, ungroupable, repeated, non-string, and past-four-level ids", () => {
    const wide = new Map([...live, ["c", {}], ["d", {}], ["e", {}]]);
    const raw = { ...state, groupBy: ["name", "name", "gone", "secret", 7, "age", "c", "d", "e"] };
    const { state: clean, dropped } = sanitizeViewState(raw, wide);
    expect(clean.groupBy).toEqual(["name", "age", "c", "d"]);
    expect(dropped).toBe(5);
  });

  it("bounds a hostile list", () => {
    const raw = { ...state, groupBy: Array.from({ length: 50_000 }, (_, i) => `c${i}`) };
    expect(sanitizeViewState(raw).state.groupBy).toHaveLength(4);
  });

  it("an imported file drops a group column that its layout hides", () => {
    const file = serializeViewFile({ name: "v", state: { ...state, groupBy: ["name", "age"], columnLayout: { ...state.columnLayout, hidden: ["age"] } } });
    const result = parseViewFile(file, live);
    expect(result.ok && result.state.groupBy).toEqual(["name"]);
  });

  it("is saved with the view", () => {
    expect(savableViewState(state)?.groupBy).toEqual(["name"]);
    expect(parseViewDocument(JSON.parse(JSON.stringify({ version: 1, defaultViewId: null, views: [{ id: "v", name: "G", state }] })))?.views[0]?.state.groupBy).toEqual(["name"]);
  });
});

describe("pivot in a view", () => {
  const live = new Map<string, { groupable?: boolean }>([["name", {}], ["age", {}], ["secret", { groupable: false }]]);
  const id = (key: number) => `__pivot:age=${key}|age=sum`;
  const pivoted: DataGridViewState = { ...state, groupBy: ["name"], pivotColumnId: "age", pivotWidths: { [id(30)]: 140 } };

  it("is kept by a capture and leaves an unpivoted capture unchanged", () => {
    expect(captureViewState(pivoted)).toMatchObject({ pivotColumnId: "age", pivotWidths: { [id(30)]: 140 } });
    expect("pivotColumnId" in captureViewState(state)).toBe(false);
    expect("pivotWidths" in captureViewState(state)).toBe(false);
  });

  it("changes the state key for another pivot column or another generated width", () => {
    expect(viewStateKey(pivoted)).not.toBe(viewStateKey(state));
    expect(viewStateKey(pivoted)).not.toBe(viewStateKey({ ...pivoted, pivotColumnId: "secret" }));
    expect(viewStateKey(pivoted)).not.toBe(viewStateKey({ ...pivoted, pivotWidths: { [id(30)]: 150 } }));
  });

  it("is saved with the view and survives a stored document as JSON", () => {
    expect(savableViewState(pivoted)).toEqual(pivoted);
    const stored = JSON.parse(JSON.stringify({ version: 1, defaultViewId: null, views: [{ id: "v", name: "P", state: pivoted }] }));
    expect(parseViewDocument(stored)!.views[0]!.state).toEqual(pivoted);
  });

  it("reads a stored view without the fields as no pivot", () => {
    const stored = JSON.parse(JSON.stringify(state));
    expect(sanitizeViewState(stored, live)).toEqual({ state, dropped: 0 });
  });

  it.each([
    ["an unknown column", { pivotColumnId: "gone" }],
    ["a column that is not groupable", { pivotColumnId: "secret" }],
    ["a groupBy column", { pivotColumnId: "name" }],
    ["a view without groupBy", { groupBy: [] }],
    ["a non-string id", { pivotColumnId: 7 }],
    ["an empty id", { pivotColumnId: "" }],
  ])("drops the pivot and its widths for %s", (_name, change) => {
    const { state: clean, dropped } = sanitizeViewState({ ...pivoted, ...change }, live);
    expect("pivotColumnId" in clean).toBe(false);
    expect("pivotWidths" in clean).toBe(false);
    expect(dropped).toBeGreaterThan(0);
  });

  it("drops a pivot column that the layout of an imported file hides", () => {
    const file = serializeViewFile({ name: "v", state: { ...pivoted, columnLayout: { ...pivoted.columnLayout, hidden: ["age"] } } });
    const result = parseViewFile(file, live);
    expect(result.ok && "pivotColumnId" in result.state).toBe(false);
    expect(result.ok && result.dropped).toBeGreaterThan(0);
  });

  it("keeps only generated widths: a header group id, a source id, and __proto__ drop", () => {
    const raw = JSON.parse(`{"__proto__": 100, "__pivotgroup:age=30": 100, "age": 100, "${id(30)}": 120}`);
    const { state: clean, dropped } = sanitizeViewState({ ...pivoted, pivotWidths: raw }, live);
    expect(clean.pivotWidths).toEqual({ [id(30)]: 120 });
    expect(Object.getPrototypeOf(clean.pivotWidths)).toBe(Object.prototype);
    expect(dropped).toBe(3);
  });

  it("drops widths that are not finite, not positive, over 10,000 px, or not numbers", () => {
    const raw = { [id(1)]: Number.NaN, [id(2)]: Number.POSITIVE_INFINITY, [id(3)]: 0, [id(4)]: -5, [id(5)]: 10_001, [id(6)]: "100", [id(7)]: 90 };
    const { state: clean, dropped } = sanitizeViewState({ ...pivoted, pivotWidths: raw }, live);
    expect(clean.pivotWidths).toEqual({ [id(7)]: 90 });
    expect(dropped).toBe(6);
  });

  it("keeps at most 200 widths and drops a generated id over 256 characters", () => {
    const long = `__pivot:${"x".repeat(300)}`;
    const many = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [id(i), 100]));
    const { state: clean, dropped } = sanitizeViewState({ ...pivoted, pivotWidths: { [long]: 100, ...many } }, live);
    expect(Object.keys(clean.pivotWidths!)).toHaveLength(200);
    expect(long in clean.pivotWidths!).toBe(false);
    expect(dropped).toBe(50_001 - 200);
  });

  it("leaves pivotWidths out when none is left", () => {
    expect("pivotWidths" in sanitizeViewState({ ...pivoted, pivotWidths: { age: 100 } }, live).state).toBe(false);
    expect("pivotWidths" in sanitizeViewState({ ...pivoted, pivotWidths: [100] }, live).state).toBe(false);
  });

  it("round-trips through a view file", () => {
    expect(parseViewFile(serializeViewFile({ name: "p", state: pivoted }), live)).toEqual({ ok: true, name: "p", state: pivoted, dropped: 0 });
  });
});
