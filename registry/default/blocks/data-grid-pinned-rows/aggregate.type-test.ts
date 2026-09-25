/**
 * Compile-time-only check: a custom aggregate reducer is generic over the grid's row type, so a
 * typed row field needs no cast. tsc gate typechecks this file; vitest's *.type-test.ts glob
 * excludes it, matching the repo's other type-test files.
 */
import type { AggregateSpecs } from "./use-data-grid-aggregate";

type Row = { id: string; score: number };

const specs: AggregateSpecs<Row> = {
  score: (_values, rows) => Math.max(...rows.map((r) => r.score), 0),
};

// the pre-generic shape (no type argument, `rows` untyped) still compiles — additive.
const legacySpecs: AggregateSpecs = { score: (values) => values.length };

void specs;
void legacySpecs;

export {};
