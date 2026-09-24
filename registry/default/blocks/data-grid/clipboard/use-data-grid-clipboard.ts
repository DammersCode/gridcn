"use client";

import { useCallback, useMemo } from "react";
import { serializeCells } from "./serialize-cells";
import { useDataGridActions, useDataGridStoreApi } from "../store";
import { useBulkGeneration } from "../validation/bulk-generation";
import { pasteText, resolveCopyScope, serializeCopyScope } from "./use-grid-clipboard";

/** Result of {@link useDataGridClipboard.prototype.pasteFromClipboard}'s permission/content outcome. */
export type PasteFromClipboardResult = "ok" | "permission-denied" | "empty";

/** Public clipboard triggers, usable outside native browser clipboard events. */
export type UseDataGridClipboardResult = {
  /**
   * Serializes the current copy scope and writes it to the OS clipboard (`navigator.clipboard.write`,
   * falling back to `document.execCommand("copy")`); resolves `'ok'` when the async Clipboard API
   * accepted the write, `'fallback'` when the legacy text/plain-only path ran instead, and
   * `'no-selection'` when there was no copy scope.
   */
  copy: () => Promise<"ok" | "fallback" | "no-selection">;
  /** Same as {@link copy}, then clears the copied selection via `deleteSelection`. */
  cut: () => Promise<"ok" | "fallback" | "no-selection">;
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

/** Writes `text`/`html` to the OS clipboard via the async Clipboard API, falling back to the guarded legacy `execCommand("copy")` path in environments without it (or without the `clipboard-write` permission); resolves which path ran. */
async function writeToClipboard(text: string, html: string): Promise<"ok" | "fallback"> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    const item = new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    });
    try {
      await navigator.clipboard.write([item]);
      return "ok";
    } catch {
      execCommandCopyFallback(text);
      return "fallback";
    }
  }
  execCommandCopyFallback(text);
  return "fallback";
}

/** Deprecated legacy fallback ONLY (guarded, last resort): a throwaway selected textarea + `document.execCommand("copy")`, used only when the async Clipboard API is unavailable or rejected. */
function execCommandCopyFallback(text: string): void {
  if (execCommandFallbackInFlight) return;
  execCommandFallbackInFlight = true;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
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
export function useDataGridClipboard(): UseDataGridClipboardResult {
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  const guard = useBulkGeneration();

  const copy = useCallback((): Promise<"ok" | "fallback" | "no-selection"> => {
    const s = storeApi.getState();
    const scope = resolveCopyScope(s);
    if (!scope) return Promise.resolve("no-selection");
    const { text, html } = serializeCells(serializeCopyScope(s, scope));
    return writeToClipboard(text, html);
  }, [storeApi]);

  const cut = useCallback((): Promise<"ok" | "fallback" | "no-selection"> => {
    const s = storeApi.getState();
    const scope = resolveCopyScope(s);
    if (!scope) return Promise.resolve("no-selection");
    const { text, html } = serializeCells(serializeCopyScope(s, scope));
    const result = writeToClipboard(text, html);
    actions.deleteSelection();
    return result;
  }, [storeApi, actions]);

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
