import { useEffect, type RefObject } from "react";

/** Focuses an input on mount with the caret at the end of its content — never select-all (diceui caret policy). */
export function useSeedFocus(ref: RefObject<HTMLInputElement | null>, _initialText: string | undefined) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // seed-once on mount; re-running on every value change would fight the user's cursor
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
