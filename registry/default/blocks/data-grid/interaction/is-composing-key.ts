import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/** Whether a key belongs to an IME composition; Safari sends the confirming Enter with `isComposing` false and keyCode 229. */
export function isComposingKey(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
