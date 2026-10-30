import { warnDev } from "./commit";

/** Whether an event-time gate answered with a promise instead of a plain value. */
export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/** A dev warning that fires once per key for the lifetime of the returned function. */
export function createWarnOnce(): (key: string, message: string) => void {
  const warned = new Set<string>();
  return (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnDev(message);
  };
}
