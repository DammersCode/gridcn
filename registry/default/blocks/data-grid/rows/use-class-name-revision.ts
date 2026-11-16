"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getCellValue } from "../columns/column-helpers";
import type { AnyColumnDef } from "../store";
import { useDataGridStoreApi } from "../store";
import type { GetCellClassName, GetRowClassName } from "../types";

type ClassNameHooks = {
  getRowClassName: GetRowClassName<unknown> | undefined;
  getCellClassName: GetCellClassName<unknown> | undefined;
};

export type RenderedRows = { viewRowIndices: readonly number[]; rowIds: readonly (string | undefined)[]; columns: readonly AnyColumnDef[] };

function classNameSignature(
  hooks: ClassNameHooks,
  data: readonly unknown[],
  viewIndex: ArrayLike<number>,
  { viewRowIndices, rowIds, columns }: RenderedRows,
): string {
  const parts: (string | undefined)[] = [];
  viewRowIndices.forEach((viewRowIndex, i) => {
    const dataIndex = viewIndex[viewRowIndex];
    const row = dataIndex === undefined ? undefined : data[dataIndex];
    const rowId = rowIds[i];
    if (row === undefined || rowId === undefined) return;
    parts.push(hooks.getRowClassName?.(row, viewRowIndex));
    if (hooks.getCellClassName === undefined) return;
    for (const column of columns) {
      parts.push(hooks.getCellClassName({ value: getCellValue<unknown, typeof column>(row, column), row, column, rowId, columnId: column.id, viewRowIndex }));
    }
  });
  return JSON.stringify(parts);
}

/**
 * Reads `getRowClassName` and `getCellClassName` through a ref, so an inline callback leaves the memoized
 * rows alone. `revision` increments when a new callback returns different classes for the rendered rows;
 * pass it to rows and cells to re-render them.
 */
export function useClassNameRevision(hooks: ClassNameHooks, renderedRef: RefObject<RenderedRows | null>) {
  const storeApi = useDataGridStoreApi();
  const latest = useRef(hooks);
  const previous = useRef(hooks);
  const [revision, setRevision] = useState(0);

  useLayoutEffect(() => {
    latest.current = hooks;
    const before = previous.current;
    previous.current = hooks;
    if (before.getRowClassName === hooks.getRowClassName && before.getCellClassName === hooks.getCellClassName) return;
    const rendered = renderedRef.current;
    if (rendered === null) return;
    const { data, viewIndex } = storeApi.getState();
    const changed = classNameSignature(before, data, viewIndex, rendered) !== classNameSignature(hooks, data, viewIndex, rendered);
    if (changed) setRevision((r) => r + 1);
  }, [hooks, renderedRef, storeApi]);

  const getRowClassName = useCallback<GetRowClassName<unknown>>((row, viewRowIndex) => latest.current.getRowClassName?.(row, viewRowIndex), []);
  const getCellClassName = useCallback<GetCellClassName<unknown>>((ctx) => latest.current.getCellClassName?.(ctx), []);
  const hasRowHook = hooks.getRowClassName !== undefined;
  const hasCellHook = hooks.getCellClassName !== undefined;
  return useMemo(
    () => ({ getRowClassName: hasRowHook ? getRowClassName : undefined, getCellClassName: hasCellHook ? getCellClassName : undefined, revision }),
    [hasRowHook, hasCellHook, getRowClassName, getCellClassName, revision],
  );
}
