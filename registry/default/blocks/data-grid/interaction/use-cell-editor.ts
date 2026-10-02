import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { CellEditorProps } from "../types";
import { useCommitGuard } from "./use-commit-guard";
import { useSeedFocus } from "./use-seed-focus";
import { columnLabelText } from "../columns/column-format-helpers";
import { isComposingKey } from "./is-composing-key";

/** The text-form codec that adapts a plain text input to a cell type's value pipeline. */
export type CellEditorCodec<TValue> = {
  /** Initial draft text for the committed `value` (mirror the type's `toText`/`toDisplayText` convention). */
  toDraft(value: TValue): string;
  /** Parse a draft into the type's value. Never throw — return the type's `clearValue` result for garbage. */
  toValue(draft: string): TValue;
};

/**
 * {@link useCellEditor}'s bindings plus a draft setter, for a built-in editor that changes the
 * draft from its own key handling (number stepping).
 */
export function useCellEditorDraft<TValue>(props: CellEditorProps<unknown, TValue>, codec: CellEditorCodec<TValue>) {
  const [text, setText] = useState(() => props.initialText ?? codec.toDraft(props.value));
  const ref = useRef<HTMLInputElement>(null);
  useSeedFocus(ref, props.initialText);
  const guard = useCommitGuard();
  // Re-arm on a rejection only: Escape clears pending right before unmount, and the unmount's blur would commit again.
  const lastRejectionCount = useRef(props.rejectionCount ?? 0);
  useEffect(() => {
    if ((props.rejectionCount ?? 0) !== lastRejectionCount.current) guard.reset();
    lastRejectionCount.current = props.rejectionCount ?? 0;
  }, [props.rejectionCount, guard]);

  const commitText = (movement?: { dx: number; dy: number }) => {
    if (!guard.tryCommit()) return;
    props.onChange(codec.toValue(text));
    props.commit(movement);
  };

  const bindings = {
    ref,
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      // Enter or Escape during IME composition confirms or cancels the composition, not the edit.
      if (isComposingKey(e)) return;
      if (e.key === "Enter") {
        commitText({ dx: 0, dy: 1 });
      } else if (e.key === "Escape") {
        props.cancel();
      }
    },
    onBlur: () => commitText({ dx: 0, dy: 0 }),
    // readOnly, not disabled: a disabled input swallows Escape and blur while an async validation is pending.
    readOnly: props.pending,
    "aria-label": columnLabelText(props.column),
    "aria-busy": props.pending || undefined,
    // The caret follows the value's script, not the grid's layout direction.
    dir: "auto" as const,
  };
  return { bindings, setDraft: setText };
}

/**
 * Owns the text-input editor boilerplate so a custom type's `Editor` stays one component:
 * draft state seeded from `initialText` (type-to-replace) or `toDraft(value)`, end-caret focus
 * on mount, the one-shot commit guard, re-arming the guard after a rejected commit (keyed off
 * `rejectionCount`, never off a plain `pending` clear), Enter (commit, move down) / Escape
 * (cancel) / blur (commit in place) handling that skips IME composition, and the column label,
 * pending state (`aria-busy`), and `dir="auto"` attributes. Spread the returned bindings onto
 * your input and pass its ref — see the worked example on the custom-cell-types page.
 */
export function useCellEditor<TValue>(props: CellEditorProps<unknown, TValue>, codec: CellEditorCodec<TValue>) {
  return useCellEditorDraft(props, codec).bindings;
}
