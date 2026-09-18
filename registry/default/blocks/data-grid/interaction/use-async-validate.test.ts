import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncValidate } from "./use-async-validate";
import type { AnyColumnDef, DataGridActions } from "../store";
import type { StandardSchemaV1 } from "../types";

/** Minimal mock StandardSchemaV1 — no library import anywhere in repo code (per spec). */
function mockAsyncSchema<TValue>(
  resolve: (value: unknown) => Promise<{ value: TValue } | { issues: { message: string }[] }>,
): StandardSchemaV1<TValue, TValue> {
  return { "~standard": { version: 1, vendor: "mock", validate: resolve as never } };
}

function mockActions(overrides: Partial<DataGridActions> = {}): DataGridActions {
  return { commitCellEdit: vi.fn(), setEditingError: vi.fn(), ...overrides } as unknown as DataGridActions;
}

describe("useAsyncValidate", () => {
  it("forwards immediately (no pending) when the column has no validate", () => {
    const actions = mockActions();
    const column = { id: "c", header: "C" } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5, { dx: 0, dy: 1 }));

    expect(actions.commitCellEdit).toHaveBeenCalledWith(5, { dx: 0, dy: 1 });
    expect(result.current.pending).toBe(false);
  });

  it("forwards immediately when validate is the function form", () => {
    const actions = mockActions();
    const column = { id: "c", header: "C", validate: () => null } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5));

    expect(actions.commitCellEdit).toHaveBeenCalledWith(5, undefined);
    expect(result.current.pending).toBe(false);
  });

  it("forwards immediately when the schema resolves synchronously (never returns a Promise)", () => {
    const actions = mockActions();
    const schema = mockAsyncSchema<number>(() => ({ value: 1 }) as never);
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5));

    expect(actions.commitCellEdit).toHaveBeenCalledWith(5, undefined);
    expect(result.current.pending).toBe(false);
  });

  it("async schema: sets pending true, then commits result.value on success and clears pending", async () => {
    const actions = mockActions();
    let resolveFn: (r: { value: number }) => void = () => {};
    const schema = mockAsyncSchema<number>(
      () => new Promise((resolve) => (resolveFn = resolve as (r: { value: number }) => void)),
    );
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5, { dx: 0, dy: 1 }));
    expect(result.current.pending).toBe(true);
    expect(actions.commitCellEdit).not.toHaveBeenCalled();

    await act(async () => {
      resolveFn({ value: 10 });
      await Promise.resolve();
    });

    expect(result.current.pending).toBe(false);
    expect(actions.commitCellEdit).toHaveBeenCalledWith(10, { dx: 0, dy: 1 });
    expect(actions.setEditingError).not.toHaveBeenCalled();
  });

  it("async schema: sets editingError on issues, leaves commitCellEdit uncalled, and clears pending", async () => {
    const actions = mockActions();
    let resolveFn: (r: { issues: { message: string }[] }) => void = () => {};
    const schema = mockAsyncSchema<number>(
      () => new Promise((resolve) => (resolveFn = resolve as (r: { issues: { message: string }[] }) => void)),
    );
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5));
    expect(result.current.pending).toBe(true);

    await act(async () => {
      resolveFn({ issues: [{ message: "server says no" }] });
      await Promise.resolve();
    });

    expect(result.current.pending).toBe(false);
    expect(actions.commitCellEdit).not.toHaveBeenCalled();
    expect(actions.setEditingError).toHaveBeenCalledWith("server says no");
  });

  it("race guard: a stale resolution (superseded by cancelPending) is dropped silently", async () => {
    const actions = mockActions();
    let resolveFn: (r: { value: number }) => void = () => {};
    const schema = mockAsyncSchema<number>(
      () => new Promise((resolve) => (resolveFn = resolve as (r: { value: number }) => void)),
    );
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5));
    expect(result.current.pending).toBe(true);

    // Escape/cancel invalidates the in-flight generation before it resolves.
    act(() => result.current.cancelPending());
    expect(result.current.pending).toBe(false);

    await act(async () => {
      resolveFn({ value: 999 });
      await Promise.resolve();
    });

    // The stale resolution must not commit or surface an error — it was dropped.
    expect(actions.commitCellEdit).not.toHaveBeenCalled();
    expect(actions.setEditingError).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("race guard: a newer commit supersedes an older in-flight one, whose resolution is dropped", async () => {
    const actions = mockActions();
    const resolvers: ((r: { value: number }) => void)[] = [];
    const schema = mockAsyncSchema<number>(
      () => new Promise((resolve) => resolvers.push(resolve as (r: { value: number }) => void)),
    );
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(1, { dx: 0, dy: 1 })); // first, in-flight
    act(() => result.current.commit(2, { dx: 1, dy: 0 })); // supersedes the first
    expect(resolvers).toHaveLength(2);

    await act(async () => {
      resolvers[0]!({ value: 111 }); // stale — must be dropped
      await Promise.resolve();
    });
    expect(actions.commitCellEdit).not.toHaveBeenCalled();

    await act(async () => {
      resolvers[1]!({ value: 222 }); // current — must commit
      await Promise.resolve();
    });
    expect(actions.commitCellEdit).toHaveBeenCalledTimes(1);
    expect(actions.commitCellEdit).toHaveBeenCalledWith(222, { dx: 1, dy: 0 });
  });

  it("race guard: unmount invalidates a pending resolution", async () => {
    const actions = mockActions();
    let resolveFn: (r: { value: number }) => void = () => {};
    const schema = mockAsyncSchema<number>(
      () => new Promise((resolve) => (resolveFn = resolve as (r: { value: number }) => void)),
    );
    const column = { id: "c", header: "C", validate: schema } as unknown as AnyColumnDef;
    const { result, unmount } = renderHook(() => useAsyncValidate(actions, column));

    act(() => result.current.commit(5));
    unmount();

    await act(async () => {
      resolveFn({ value: 10 });
      await Promise.resolve();
    });

    expect(actions.commitCellEdit).not.toHaveBeenCalled();
    expect(actions.setEditingError).not.toHaveBeenCalled();
  });
});
