"use client";

import { useCallback, useMemo } from "react";
import { serializeCells } from "./serialize-cells";
import { useDataGridInternalActions, useDataGridStoreApi } from "../store";
import { useBulkGeneration } from "../validation/bulk-generation";
import { copyScopeCellIds, pasteText, resolveCopyScope, serializeCopyScope } from "./use-grid-clipboard";

/** Result of {@link useDataGridClipboard.prototype.pasteFromClipboard}'s permission/content outcome. */
export type PasteFromClipboardResult = "ok" | "permission-denied" | "empty";

/** Options for {@link useDataGridClipboard}. */
export type UseDataGridClipboardOptions = {
  /** Prefix formula-like cells with `'` in the copied text and HTML (see {@link serializeCells}); default: the grid's `sanitizeClipboardFormulas` prop. */
  sanitizeFormulas?: boolean;
};

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
   * (`'ok'`/`'fallback'`) and the selection is the same reference it was when the write started.
   * The cells are captured by row and column id at copy time, so a sort, filter, or data change
   * during the write clears the copied rows wherever they moved; a row that left the view stays.
   * A failed write keeps the selection intact.
   */
  cut: () => Promise<"ok" | "fallback" | "failed" | "no-selection">;
  /**
   * Reads `navigator.clipboard.readText()` and applies it through the same parse -> writes ->
   * applyCellUpdates pipeline as a native paste. Resolves `'permission-denied'` when the read is
   * rejected (no `clipboard-read` permission — the context-menu add-on falls back to a
   * "press Ctrl+V" hint), `'empty'` when the clipboard held no usable text, else `'ok'`.
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
 * Copy/Cut/Paste items). Mirrors {@link useGridClipboard}'s native-event pipeline exactly, so
 * behavior stays identical whether the user presses Ctrl+C or clicks a menu item.
 */
export function useDataGridClipboard(options: UseDataGridClipboardOptions = {}): UseDataGridClipboardResult {
  const { sanitizeFormulas } = options;
  const actions = useDataGridInternalActions();
  const storeApi = useDataGridStoreApi();
  const guard = useBulkGeneration();

  const copy = useCallback((): Promise<"ok" | "fallback" | "failed" | "no-selection"> => {
    const s = storeApi.getState();
    const scope = resolveCopyScope(s);
    if (!scope) return Promise.resolve("no-selection");
    const { text, html } = serializeCells(serializeCopyScope(s, scope), { sanitizeFormulas: sanitizeFormulas ?? s.sanitizeClipboardFormulas });
    return writeToClipboard(text, html);
  }, [storeApi, sanitizeFormulas]);

  const cut = useCallback(async (): Promise<"ok" | "fallback" | "failed" | "no-selection"> => {
    const s = storeApi.getState();
    const scope = resolveCopyScope(s);
    if (!scope) return "no-selection";
    const { text, html } = serializeCells(serializeCopyScope(s, scope), { sanitizeFormulas: sanitizeFormulas ?? s.sanitizeClipboardFormulas });
    const { rowIds, columnIds } = copyScopeCellIds(s, scope);
    const result = await writeToClipboard(text, html);
    // A view rebuild may drop the range; only a new range from the user cancels the delete.
    const current = storeApi.getState().selection.current;
    if (result !== "failed" && (current === s.selection.current || current === null)) actions._deleteCellsById(rowIds, columnIds);
    return result;
  }, [storeApi, actions, sanitizeFormulas]);

  const pasteFromClipboard = useCallback(async (): Promise<PasteFromClipboardResult> => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return "permission-denied";
    }
    if (!text) return "empty";
    const s = storeApi.getState();
    const applied = pasteText(s, actions, text, guard, storeApi);
    return applied ? "ok" : "empty";
  }, [storeApi, actions, guard]);

  return useMemo(() => ({ copy, cut, pasteFromClipboard }), [copy, cut, pasteFromClipboard]);
}
