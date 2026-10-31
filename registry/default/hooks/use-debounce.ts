"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type KeyboardEvent } from "react";

const DEFAULT_DELAY_MS = 300;

/** The debounced copy of `value`: it follows `value` once `value` has stayed the same for `delayMs`. */
export function useDebounce<T>(value: T, delayMs: number = DEFAULT_DELAY_MS): T {
  const [debounced, setDebounced] = useState(value);
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
  /** The text in the input: what the user typed, or `value` when nothing is pending. */
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

// Same check as the `is-composing-key` item, copied so this item has no dependency. Safari confirms an IME composition with keyCode 229 after `isComposing` is already false.
const isComposingKey = (event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }): boolean =>
  event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229;

/**
 * A text input that shows each keystroke at once and calls `onCommit` once the typing pauses. `value` is the
 * committed text; when it changes from outside and nothing is pending, the input shows it. A pending value is
 * never lost: it commits on blur, on Enter, and on unmount. An IME composition commits when it ends. After a commit the
 * input shows `value` again, so update `value` in the same `onCommit` call.
 */
export function useDebouncedInput(value: string, onCommit: (next: string) => void, options: UseDebouncedInputOptions = {}): UseDebouncedInputResult {
  const { delayMs = DEFAULT_DELAY_MS } = options;
  const [typed, setTyped] = useState<string | null>(null);
  // While text is pending the input shows it, so a late echo of an older commit never overwrites what the user types.

  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
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
    setTyped(null);
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
      setTyped(next);
      pendingRef.current = next;
      if (composingRef.current) return;
      schedule(next);
    },
    [schedule],
  );

  const inputValue = typed ?? value;
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
        setTyped(next);
        schedule(next);
      },
    },
    flush,
    cancel,
  };
}
