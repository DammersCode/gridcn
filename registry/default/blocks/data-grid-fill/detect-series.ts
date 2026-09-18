/** Extrapolates a detected series to any index; `null` for a non-series (falls back to tiling). */
export type SeriesDescriptor = {
  extrapolate(index: number): string;
};

const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const PADDED_INT_RE = /^\d+$/;
const PREFIX_NUMBER_RE = /^(.*?)(\d+)(\D*)$/;
const EPSILON = 1e-9;

function decimalPlaces(value: string): number {
  const dotIndex = value.indexOf(".");
  return dotIndex === -1 ? 0 : value.length - dotIndex - 1;
}

function detectArithmetic(values: string[]): SeriesDescriptor | null {
  // callers only reach here via detectSeries, which requires values.length >= 2
  if (values.length < 2) return null;
  const trimmed = values.map((v) => v.trim());
  const nums = trimmed.map((v) => (NUMERIC_RE.test(v) ? Number(v) : null));
  if (nums.some((n) => n === null)) return null;
  const numbers = nums as number[];
  const first = numbers[0]!;
  const delta = numbers[1]! - first;
  for (let i = 2; i < numbers.length; i++) {
    if (Math.abs(numbers[i]! - numbers[i - 1]! - delta) > EPSILON) return null;
  }
  const precision = Math.max(...trimmed.map(decimalPlaces));
  return {
    extrapolate: (index: number) => (first + delta * index).toFixed(precision),
  };
}

function detectPaddedNumeric(values: string[]): SeriesDescriptor | null {
  if (values.length < 2) return null;
  const trimmed = values.map((v) => v.trim());
  if (!trimmed.every((v) => PADDED_INT_RE.test(v))) return null;
  if (!trimmed.some((v) => v.length > 1 && v.startsWith("0"))) return null;
  const width = trimmed[0]!.length;
  if (!trimmed.every((v) => v.length === width)) return null;
  const numbers = trimmed.map((v) => Number(v));
  const first = numbers[0]!;
  const delta = numbers[1]! - first;
  for (let i = 2; i < numbers.length; i++) {
    if (numbers[i]! - numbers[i - 1]! !== delta) return null;
  }
  return {
    extrapolate: (index: number) => {
      const n = first + delta * index;
      const sign = n < 0 ? "-" : "";
      const digits = String(Math.abs(n)).padStart(width, "0");
      return sign + digits;
    },
  };
}

function detectPrefixNumber(values: string[]): SeriesDescriptor | null {
  if (values.length < 2) return null;
  const matches = values.map((v) => v.trim().match(PREFIX_NUMBER_RE));
  if (matches.some((m) => m === null)) return null;
  const parsed = matches as RegExpMatchArray[];
  const prefix = parsed[0]![1];
  const suffix = parsed[0]![3];
  if (!parsed.every((m) => m[1] === prefix && m[3] === suffix)) return null;

  const numStrings = parsed.map((m) => m[2]!);
  const numbers = numStrings.map((n) => Number(n));
  const width = numStrings[0]!.length;
  const uniformWidth = numStrings.every((n) => n.length === width) && numStrings.some((n) => n.startsWith("0"));

  const first = numbers[0]!;
  const delta = numbers[1]! - first;
  for (let i = 2; i < numbers.length; i++) {
    if (numbers[i]! - numbers[i - 1]! !== delta) return null;
  }
  return {
    extrapolate: (index: number) => {
      const n = first + delta * index;
      const digits = uniformWidth && n >= 0 ? String(n).padStart(width, "0") : String(n);
      return prefix + digits + suffix;
    },
  };
}

/**
 * Detects a fillable series in `values` (source cells along the fill axis, in
 * source order): arithmetic progressions, zero-padded numeric strings (pad
 * width preserved), or shared-prefix/suffix + arithmetic numeric part
 * ("Item 1", "Item 2"). Requires at least 2 values with a consistent delta;
 * returns `null` when no pattern applies (caller falls back to tiling).
 */
export function detectSeries(values: string[]): SeriesDescriptor | null {
  if (values.length < 2) return null;
  // padded numerics ("001") also match plain arithmetic, so check padding first or the leading zero is lost
  return detectPaddedNumeric(values) ?? detectArithmetic(values) ?? detectPrefixNumber(values);
}
