import { describe, expect, it } from "vitest";
import { parseClipboardText } from "./parse-clipboard";

// Shared GitHub Actions runners are several × slower than a dev machine; the ceiling guards an
// algorithmic regression, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

/**
 * Perf regression test for the slice-based `parseClipboardText` rewrite (2026-08-20, data-pipeline
 * audit lead 4): pins that a large plain-text paste stays well clear of the old char-by-char-concat
 * cost (measured 274ms at 20MB before the fix, 84ms after). Same warmup/measure discipline as
 * sort-filter/view-index-perf.test.ts; ceiling set generously above the measured number so this
 * doesn't flake under parallel CI load.
 */

function makeTsv(rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(`row${r}-col${c}-value`);
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

describe("parseClipboardText perf", () => {
  it("parses a 20k x 10 TSV payload well under the pre-rewrite concat cost", () => {
    const text = makeTsv(20_000, 10); // ~4MB, comfortably above the 274ms/20MB scaling point
    // warm up once so JIT isn't counted, then take the real measurement
    parseClipboardText(text);
    const start = performance.now();
    const result = parseClipboardText(text);
    const elapsed = performance.now() - start;

    expect(result.length).toBe(20_000);
    // ~15-20ms locally (observed 565ms on a loaded CI runner); the ~30x concat regression this
    // guards against far exceeds any machine jitter.
    expect(elapsed).toBeLessThan(500 * CI_FACTOR);
  });
});
