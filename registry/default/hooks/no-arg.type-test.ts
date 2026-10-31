import { useDebounce, useDebouncedInput } from "./use-debounce";

/** Compile-only: both hooks take their options optionally, so a bare call compiles. */
export function noOptions() {
  const debounced: string = useDebounce("a");
  const input = useDebouncedInput("", (next: string) => void next);
  const text: string = input.inputProps.value;
  return [debounced, text, input.flush, input.cancel] as const;
}
