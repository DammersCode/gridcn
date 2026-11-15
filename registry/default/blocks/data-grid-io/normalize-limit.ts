/** Clamps a caller limit to a non-negative integer: `NaN` falls back, `Infinity` becomes the largest safe integer. */
export function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(0, Math.floor(value)), Number.MAX_SAFE_INTEGER);
}
