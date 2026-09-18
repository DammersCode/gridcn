/** Shared seeded dataset for the benchmark pages — every grid renders the exact same rows/columns. */

export type BenchmarkRow = {
  id: string;
  n: number;
  name: string;
  email: string;
  age: number;
  active: boolean;
  role: string;
  joined: string;
  score: number;
};

export const ROW_SIZE_OPTIONS = [1_000, 100_000, 1_000_000] as const;
export type BenchmarkRowSize = (typeof ROW_SIZE_OPTIONS)[number];

/** Fixed id so results across grids/runs reference the same generated data. */
export const DATASET_SEED = 42;

export const ROLES = ["Admin", "User", "Editor", "Viewer", "Manager"] as const;
export const ROLE_CHOICES = ROLES.map((value) => ({ value, label: value }));

const ADJECTIVES = ["Eager", "Quick", "Silent", "Bold", "Swift"];
const NOUNS = ["Eagle", "Lion", "Tiger", "Bear", "Wolf"];

/** Deterministic LCG so every grid/run/reload sees byte-identical rows without Math.random(). */
function createSeededLCG(seed: number) {
  let state = seed;
  return {
    next(): number {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    },
  };
}

/** Generated on demand (never at module scope) — 1M rows held in memory only while a page needs them. */
export function generateBenchmarkRows(count: number): BenchmarkRow[] {
  const rng = createSeededLCG(DATASET_SEED);
  const rows: BenchmarkRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      n: i,
      name: `${ADJECTIVES[Math.floor(rng.next() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rng.next() * NOUNS.length)]}`,
      email: `user${i}@example.com`,
      age: Math.floor(rng.next() * 50) + 18,
      active: rng.next() > 0.5,
      role: ROLES[Math.floor(rng.next() * ROLES.length)] ?? "User",
      joined: `${2020 + Math.floor(rng.next() * 5)}-${String(Math.floor(rng.next() * 12) + 1).padStart(2, "0")}-${String(Math.floor(rng.next() * 28) + 1).padStart(2, "0")}`,
      score: Math.floor(rng.next() * 100),
    });
  }
  return rows;
}

export const RUN_ENVIRONMENT_NOTE =
  "Headed (non-headless) Chrome is the meaningful environment for fps — headless throttles/coalesces rAF differently.";

/** Matches the gridcn `date` column's displayFormat/locale so every grid pays the same per-cell formatting cost. */
export const DATE_DISPLAY_FORMAT: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "2-digit" };
export const DATE_LOCALE = "en-US";

const dateFormatter = new Intl.DateTimeFormat(DATE_LOCALE, DATE_DISPLAY_FORMAT);

/** ISO `yyyy-mm-dd` (the shared row shape) as a local-midnight Date — the form MUI X's `type: 'date'` requires. */
export function isoToLocalDate(iso: string): Date | null {
  const parts = iso.split("-").map(Number);
  const [year, month, day] = parts as [number, number, number];
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return new Date(year, month - 1, day);
}

export function formatJoined(iso: string): string {
  const date = isoToLocalDate(iso);
  return date ? dateFormatter.format(date) : iso;
}

/** Single number format for the score column across all four grids. */
export function formatScore(value: number): string {
  return value.toFixed(1);
}
