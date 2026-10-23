import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridInternalActions, useDataGridSearchMatches, useDataGridStore } from "../store";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [
  { id: "1", name: "Foo" },
  { id: "2", name: "foo" },
  { id: "3", name: "foobar" },
];

function makeWrapper(props: { searchText?: string } = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r: Row) => r.id} {...props}>
        {children}
      </DataGridProvider>
    );
  };
}

function useSearch() {
  return {
    actions: useDataGridInternalActions(),
    matches: useDataGridSearchMatches(),
    options: useDataGridStore((s) => s.searchOptions),
  };
}

describe("setSearch options", () => {
  it("starts case-insensitive and partial", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper() });
    expect(result.current.options).toEqual({ matchCase: false, wholeCell: false });
  });

  it("matchCase narrows the matches", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper() });
    act(() => result.current.actions.setSearch("foo", { matchCase: true }));
    expect(result.current.matches.map((m) => m.row)).toEqual([1, 2]);
  });

  it("wholeCell narrows the matches", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper() });
    act(() => result.current.actions.setSearch("foo", { wholeCell: true }));
    expect(result.current.matches.map((m) => m.row)).toEqual([0, 1]);
  });

  it("keeps the options when a later search omits them", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper() });
    act(() => result.current.actions.setSearch("foo", { wholeCell: true }));
    act(() => result.current.actions.setSearch("FOO"));
    expect(result.current.options.wholeCell).toBe(true);
    expect(result.current.matches.map((m) => m.row)).toEqual([0, 1]);
  });

  it("applies options on top of a controlled searchText", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper({ searchText: "foo" }) });
    expect(result.current.matches).toHaveLength(3);
    act(() => result.current.actions.setSearch("foo", { matchCase: true }));
    expect(result.current.matches.map((m) => m.row)).toEqual([1, 2]);
  });

  it("a controlled search ignores new text when the options are unchanged", () => {
    const { result } = renderHook(useSearch, { wrapper: makeWrapper({ searchText: "foo" }) });
    const before = result.current.matches;
    act(() => result.current.actions.setSearch("zzz"));
    expect(result.current.matches).toBe(before);
  });
});
