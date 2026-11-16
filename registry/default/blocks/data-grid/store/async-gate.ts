/** Whether an event-time gate answered with a promise instead of a plain value. */
export function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}
