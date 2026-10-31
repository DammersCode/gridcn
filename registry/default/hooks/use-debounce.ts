"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from "react";

/** The text the user typed. `queue` holds the commits the parent has not applied yet; `seen` is the last `value` handled. */
type TypedText = { text: string; seen: string; pending: boolean; queue: string[] };

/**
 * What the input shows after a render. The typed text stays while it is pending and while commits are queued. It
 * yields when `value` reaches the typed text (the display does not change then), when the queue is applied, or when
 * `value` becomes a text that is not queued (the parent changed it from outside). A `value` that matches a queued
 * commit applies it and every commit before it.
 */
function settleTyped(typed: TypedText | null, value: string): TypedText | null {
  if (typed === null || typed.pending || value === typed.seen) return typed;
  if (value === typed.text) return null;
  const at = typed.queue.indexOf(value);
  if (at === -1) return null;
  const rest = typed.queue.slice(at + 1);
  return rest.length === 0 ? null : { ...typed, seen: value, queue: rest };
}

const DEFAULT_DELAY_MS = 300;
/** Commits remembered while the parent has not applied them yet. */
const MAX_QUEUED = 8;

/** The debounced copy of `value`: it follows `value` once `value` has stayed the same for `delayMs`. */
export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
  if (delayMs <= 0 && debounced !== value) setDebounced(value);
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return delayMs <= 0 ? value : debounced;
}

/** Options for {@link useDebouncedInput}. */
export type UseDebouncedInputOptions = {
  /** Wait between the last keystroke and the commit. `0` commits each keystroke. Default 300. */
  delayMs?: number;
};

/** The props of the input that {@link useDebouncedInput} drives. Spread them: `<input {...input.inputProps} />`. */
export type DebouncedInputProps = {
  /** The text in the input: what the user typed while it is pending or until `value` reaches it, otherwise `value`. */
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Commits a pending value, so a click elsewhere never loses the last keystrokes. */
  onBlur: () => void;
  /** Enter commits a pending value; Escape drops it and restores `value`. Neither acts while an IME composes. */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onCompositionStart: () => void;
  /** Schedules the commit of the composed text. */
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

/** Return value of {@link useDebouncedInput}. */
export type UseDebouncedInputResult = {
  /** The text in the input; the same as `inputProps.value`. */
  inputValue: string;
  inputProps: DebouncedInputProps;
  /** Commits a pending value now. */
  flush: () => void;
  /** Drops a pending value and shows `value` again. */
  cancel: () => void;
};

// Copy of the `is-composing-key` item, so this item has no dependency. Safari confirms a composition with keyCode 229.
const isComposingKey = (event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }): boolean =>
  event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229;

/**
 * A text input that shows each keystroke at once and calls `onCommit` once the typing pauses. `value` is the
 * committed text; when it changes from outside and nothing is pending, the input shows it. A pending value is
 * never lost: it commits on blur, on Enter, and on unmount. An IME composition commits when it ends. After a commit the
 * input keeps the typed text until `value` reaches it or moves to a text the user did not commit, then shows `value`.
 */
export function useDebouncedInput(value: string, onCommit: (next: string) => void, options: UseDebouncedInputOptions = {}): UseDebouncedInputResult {
  const { delayMs = DEFAULT_DELAY_MS } = options;
  // The input shows the typed text while it is pending, and after the commit until the parent has applied the commits:
  // a parent that applies a commit later never flashes the old text, and a late echo of an older commit never
  // overwrites what the user types.
  const [typed, setTyped] = useState<TypedText | null>(null);
  const onCommitRef = useRef(onCommit);
  const valueRef = useRef(value);
  useLayoutEffect(() => {
    onCommitRef.current = onCommit;
    valueRef.current = value;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const composingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next === null) return;
    setTyped((prev) => (prev === null ? prev : { ...prev, pending: false, queue: [...prev.queue, next].slice(-MAX_QUEUED) }));
    onCommitRef.current(next);
  }, [clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    composingRef.current = false;
    setTyped(null);
  }, [clearTimer]);

  const schedule = useCallback(
    (next: string) => {
      pendingRef.current = next;
      clearTimer();
      if (delayMs <= 0) {
        flush();
        return;
      }
      timerRef.current = setTimeout(flush, delayMs);
    },
    [clearTimer, delayMs, flush],
  );

  useEffect(() => flush, [flush]);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value;
      setTyped((prev) => ({ text: next, seen: prev?.seen ?? valueRef.current, pending: true, queue: prev?.queue ?? [] }));
      pendingRef.current = next;
      if (composingRef.current) return;
      schedule(next);
    },
    [schedule],
  );

  const settled = settleTyped(typed, value);
  if (settled !== typed) setTyped(settled);
  const inputValue = settled === null ? value : settled.text;
  return {
    inputValue,
    inputProps: {
      value: inputValue,
      onChange,
      onBlur: flush,
      onKeyDown: (event) => {
        if (isComposingKey(event)) return;
        if (event.key === "Enter") flush();
        else if (event.key === "Escape") cancel();
      },
      onCompositionStart: () => {
        composingRef.current = true;
        clearTimer();
      },
      onCompositionEnd: (event) => {
        composingRef.current = false;
        const next = event.currentTarget.value;
        setTyped((prev) => ({ text: next, seen: prev?.seen ?? valueRef.current, pending: true, queue: prev?.queue ?? [] }));
        schedule(next);
      },
    },
    flush,
    cancel,
  };
}
