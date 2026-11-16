"use client";

import { useCallback, useMemo } from "react";
import { serializeCells } from "./serialize-cells";
import { useDataGridActions, useDataGridInternalActions, useDataGridStoreApi, type DataGridStoreState } from "../store";
import { rowIdAtViewRow } from "../store/compute";
import { useBulkGeneration } from "../validation/bulk-generation";
import { copyScopeCellIds, pasteText, resolveCopyScope, serializeCopyScope } from "./use-grid-clipboard";

/** The paste result: `"ok"` (a paste started), `"permission-denied"`, `"empty"` (no text on the clipboard), or `"refused"` (the grid started no paste). */
export type PasteFromClipboardResult = "ok" | "permission-denied" | "empty" | "refused";

/** Options for {@link useDataGridClipboard}. */
export type UseDataGridClipboardOptions = {
  /** Prefix formula-like cells with `'` in the copied text and HTML (see {@link serializeCells}); default: the grid's `sanitizeClipboardFormulas` prop. */
  sanitizeFormulas?: boolean;
};

/** Whether a view rebuild kept the range (only its anchor followed the cursor) or collapsed it onto the cursor's record and column. */
function selectionFollowedRebuild(before: DataGridStoreState, after: DataGridStoreState): boolean {
  const current = after.selection.current;
  const kept = before.selection.current;
  if (current && kept && current.range === kept.range && current.rangeStack === kept.rangeStack) return true;
  const from = before.activeCell;
  const to = after.activeCell;
  if (!current || !from || !to || current.rangeStack.length > 0) return false;
  const { range, cell } = current;
  if (range.width !== 1 || range.height !== 1 || cell.row !== to.row || cell.col !== to.col) return false;
  return rowIdAtViewRow(before, from.row) === rowIdAtViewRow(after, to.row) && before.visibleColumns[from.col]?.id === after.visibleColumns[to.col]?.id;
}

/** Public clipboard triggers, usable outside native browser clipboard events. */
export type UseDataGridClipboardResult = {
  /**
   * Serializes the current copy scope and writes it to the OS clipboard (`navigator.clipboard.write`,
   * falling back to `document.execCommand("copy")`); resolves `'ok'` when the async Clipboard API
   * accepted the write, `'fallback'` when the legacy text/plain-only path reported success,
   * `'failed'` when both paths failed, and `'no-selection'` when there was no copy scope.
   */
  copy: () => Promise<"ok" | "fallback" | "failed" | "no-selection">;
  /**
   * Same as {@link copy}, then clears exactly the copied cells — only when the write succeeded
   * (`'ok'`/`'fallback'`) and nobody selected or cleared cells during the write. A view rebuild
   * that keeps the range, drops it, or collapses it onto the followed active cell keeps the cut; a
   * clamp that moves the active cell collapses the selection onto another record and cancels it.
   * The cells are captured by row and column id at copy time, so a sort, filter, or data change
   * during the write clears the copied rows wherever they moved; a row that left the view stays.
   * A failed write keeps the selection intact. Resolves `'refused'` and does nothing while a cell editor is open.
   */
  cut: () => Promise<"ok" | "fallback" | "failed" | "no-selection" | "refused">;
  /**
   * Reads `navigator.clipboard.readText()` and applies it through the same parse -> writes ->
   * applyCellUpdates pipeline as a native paste. Resolves `'permission-denied'` when the read is
   * rejected (no `clipboard-read` permission — the context-menu add-on falls back to a
   * "press Ctrl+V" hint), else `'ok'` when a paste started. Resolves `'empty'` when the clipboard held no
   * text, and `'refused'` when no paste started: the grid is `readOnly`, a cell editor is open, there is no paste target,
   * a sync `processPaste` vetoed it, or the text parses to no cells. An async `processPaste` decides after `'ok'`.
   * A paste aborts an earlier paste whose gate or async schema is still pending (`onGateAborted` reason `"superseded"`).
   */
  pasteFromClipboard: () => Promise<PasteFromClipboardResult>;
};

/** Guards {@link execCommandCopyFallback} against re-entrancy — a second copy fired while the async `clipboard.write` rejection from the first is still in flight must not double-run the legacy fallback. */
let execCommandFallbackInFlight = false;

/** Writes `text`/`html` to the OS clipboard via the async Clipboard API, falling back to the guarded legacy `execCommand("copy")` path in environments without it (or without the `clipboard-write` permission); resolves which path ran, or `'failed'` when both paths report failure. */
async function writeToClipboard(text: string, html: string): Promise<"ok" | "fallback" | "failed"> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    const item = new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    });
    try {
      await navigator.clipboard.write([item]);
      return "ok";
    } catch {
      return execCommandCopyFallback(text) ? "fallback" : "failed";
    }
  }
  return execCommandCopyFallback(text) ? "fallback" : "failed";
}

/** Deprecated legacy fallback ONLY (guarded, last resort): a throwaway selected textarea + `document.execCommand("copy")`, used only when the async Clipboard API is unavailable or rejected; returns whether `execCommand` reported success. */
function execCommandCopyFallback(text: string): boolean {
  if (execCommandFallbackInFlight) return false;
  execCommandFallbackInFlight = true;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    execCommandFallbackInFlight = false;
  }
}

/**
 * Public clipboard triggers for use outside native clipboard events (e.g. a context menu's
 * Copy/Cut/Paste items). Runs the same copy scope, serializer, and paste pipeline as
 * {@link useGridClipboard}. Unlike the native events, `copy()` also runs while a cell editor is
 * open; `cut()` and `pasteFromClipboard()` refuse.
 *
 * Copy and paste address the displayed rows. On a paged grid that is the shown page: a column
 * selection copies the rows of the page, and a paste stops at the page's last row.
 */
export function useDataGridClipboard(options: UseDataGridClipboardOptions = {}): UseDataGridClipboardResult {
  const { sanitizeFormulas } = options;
  const actions = useDataGridActions();
  const internalActions = useDataGridInternalActions();
  const storeApi = useDataGridStoreApi();
  const guard = useBulkGeneration();

  const copy = useCallback((): Promise<"ok" | "fallback" | "failed" | "no-selection"> => {
    const s = storeApi.getState();
    const scope = resolveCopyScope(s);
    if (!scope) return Promise.resolve("no-selection");
    const { text, html } = serializeCells(serializeCopyScope(s, scope), { sanitizeFormulas: sanitizeFormulas ?? s.sanitizeClipboardFormulas });
    return writeToClipboard(text, html);
  }, [storeApi, sanitizeFormulas]);

  const cut = useCallback(async (): Promise<"ok" | "fallback" | "failed" | "no-selection" | "refused"> => {
    const s = storeApi.getState();
    // the open editor would commit its draft over the cleared cell
    if (s.editing) return "refused";
    const scope = resolveCopyScope(s);
    if (!scope) return "no-selection";
    const { text, html } = serializeCells(serializeCopyScope(s, scope), { sanitizeFormulas: sanitizeFormulas ?? s.sanitizeClipboardFormulas });
    const { rowIds, columnIds } = copyScopeCellIds(s, scope);
    const result = await writeToClipboard(text, html);
    // A view rebuild keeps, drops, or collapses the range; a new or cleared range from the user cancels the delete.
    const latest = storeApi.getState();
    const current = latest.selection.current;
    const rebuilt = latest.viewIndex !== s.viewIndex || latest.visibleColumns !== s.visibleColumns;
    const selectionKept = current === s.selection.current || (rebuilt && (current === null || selectionFollowedRebuild(s, latest)));
    if (result !== "failed" && selectionKept) internalActions._deleteCellsById(rowIds, columnIds);
    return result;
  }, [storeApi, internalActions, sanitizeFormulas]);

  const pasteFromClipboard = useCallback(async (): Promise<PasteFromClipboardResult> => {
    const before = storeApi.getState();
    if (before.readOnly || before.editing) return "refused";
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return "permission-denied";
    }
    if (!text) return "empty";
    const s = storeApi.getState();
    const applied = pasteText(s, actions, text, guard, storeApi);
    return applied ? "ok" : "refused";
  }, [storeApi, actions, guard]);

  return useMemo(() => ({ copy, cut, pasteFromClipboard }), [copy, cut, pasteFromClipboard]);
}
