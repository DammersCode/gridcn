# Client-side sort at 1,000,000 rows

Goal: sort 1,000,000 rows by a text column and by a number column clearly faster, with identical
results. Method: measure first, profile, then change. Every number below comes from
`scripts/bench-sort.mjs`, which runs the baseline commit (`bb190349`) and the current code
alternately in one process on the same seeded rows, checks that both return the same order, and
reports the median and the median absolute deviation (MAD) of 5 runs (7 at 100k) after 2 warm-ups.

Machine: Windows 11 desktop, Node 24.15, other work running on the machine. Absolute times vary by
about 1.5x between runs; the paired ratios hold. Row counts are stated per table: **1M** is
1,000,000 rows, **100k** is 100,000 rows.

## Where the time went (CPU profile, 1M rows)

- Number sort: about 75% of the time sat in the comparator closure chain (decorated objects, key
  lookups, direction multiplier, tie-break), not in the sort itself.
- Text sort: about 56% sat in the native `localeCompare` and about 29% in the comparator closure.
  Each of the 20 million comparisons collated whole strings, although a typical column has far fewer
  distinct strings than rows.

## What changed

- `sort-filter/keyed-sort.ts`: every sort column becomes one unsigned integer key per row, then a
  stable least-significant-digit radix sort orders the keys from the last sort column to the first.
  A tie on every key keeps data order, which is the old tie-break.
  - Number columns: the IEEE-754 bits, flipped so integer order is numeric order. Empty cells take
    the all-ones key, so they sort last in both directions.
  - Text columns: the dense rank of each row's string. Only the distinct strings are sorted, with
    the original comparator (`localeCompare` for the `text` cell type, the numeric base-sensitivity
    collator for untyped columns). Strings the comparator calls equal share a rank.
  - Anything it cannot key exactly returns `null`, and `buildViewIndex` runs the old
    comparator-chain sort: a column `sortCompare`, a cell type with its own `compare`, NaN or
    infinite values, text in a number column, magnitudes above 1e300, non-string values in a `text`
    column, and fewer than 256 rows.
- `incremental-view-index.ts` (live updates): keeps the previous array when every touched row still
  sits between its neighbours, moves one row with `copyWithin`, and merges a batch of more than 4
  rows in one pass. `data-write.ts`: an `"immediate"` tick skips the view work when the view is
  settled and no patch can reach a sort or filter input (plain `accessorKey` columns only).

## Results: sort step, 1M rows

| Case | Baseline ms (MAD) | Now ms (MAD) | Speedup | Peak RSS delta MB (baseline / now) |
| --- | --- | --- | --- | --- |
| dataset: number (score) asc | 566 (±10) | 89 (±8) | 6.3x | 67 / 65 |
| dataset: number (age) desc | 694 (±29) | 83 (±3) | 8.4x | 67 / 63 |
| dataset: text (name) asc | 779 (±58) | 93 (±10) | 8.3x | 68 / 52 |
| dataset: filter age >= 30, no sort | 70 (±8) | 73 (±2) | 1.0x | 55 / 53 |
| dataset: filter name contains, no sort | 92 (±7) | 77 (±2) | 1.2x | 41 / 40 |
| text asc | 4869 (±144) | 1721 (±85) | 2.8x | 66 / 67 |
| text desc | 5143 (±509) | 1673 (±43) | 3.1x | 62 / 75 |
| text asc, input sorted | 612 (±39) | 787 (±28) | 0.8x | 53 / 96 |
| text asc, input reversed | 876 (±90) | 702 (±5) | 1.2x | 54 / 92 |
| text (no cell type) asc | 3917 (±24) | 2179 (±151) | 1.8x | 72 / 94 |
| digits asc | 3846 (±106) | 1346 (±77) | 2.9x | 65 / 116 |
| number int asc | 1150 (±11) | 100 (±5) | 11.5x | 56 / 64 |
| number int desc | 1085 (±13) | 75 (±11) | 14.4x | 40 / 64 |
| number float asc | 2852 (±10) | 117 (±10) | 24.3x | 39 / 64 |
| number float desc | 4977 (±403) | 176 (±20) | 28.3x | 38 / 66 |
| number float asc, input sorted | 618 (±155) | 350 (±23) | 1.8x | 49 / 65 |
| number float asc, input reversed | 612 (±89) | 304 (±18) | 2.0x | 54 / 64 |
| number with NaN asc | 1798 (±395) | 1631 (±195) | 1.1x | 67 / 65 |
| 2 keys: text asc, int desc | 6932 (±1118) | 1997 (±95) | 3.5x | 48 / 82 |
| 2 keys: int asc, text asc | 3765 (±44) | 1111 (±24) | 3.4x | 46 / 83 |

## Results: sort step, 100k rows

| Case | Baseline ms (MAD) | Now ms (MAD) | Speedup | Peak RSS delta MB (baseline / now) |
| --- | --- | --- | --- | --- |
| dataset: number (score) asc | 62 (±3) | 8 (±1) | 7.6x | 5 / 0 |
| dataset: number (age) desc | 81 (±9) | 8 (±2) | 9.7x | 4 / 0 |
| dataset: text (name) asc | 102 (±9) | 11 (±3) | 9.4x | 5 / 0 |
| dataset: filter age >= 30, no sort | 10 (±1) | 13 (±2) | 0.8x | 0 / 0 |
| dataset: filter name contains, no sort | 14 (±2) | 13 (±1) | 1.1x | 1 / 0 |
| text asc | 406 (±9) | 137 (±12) | 3.0x | 5 / 8 |
| text desc | 375 (±4) | 123 (±8) | 3.1x | 5 / 7 |
| text asc, input sorted | 56 (±3) | 52 (±5) | 1.1x | 4 / 8 |
| text asc, input reversed | 63 (±9) | 49 (±3) | 1.3x | 5 / 8 |
| text (no cell type) asc | 386 (±46) | 194 (±25) | 2.0x | 5 / 7 |
| digits asc | 260 (±11) | 111 (±11) | 2.3x | 5 / 14 |
| number int asc | 142 (±5) | 10 (±3) | 13.6x | 5 / 0 |
| number int desc | 120 (±9) | 8 (±2) | 15.2x | 5 / 0 |
| number float asc | 226 (±18) | 14 (±2) | 16.4x | 5 / 0 |
| number float desc | 219 (±12) | 12 (±1) | 18.6x | 5 / 0 |
| number float asc, input sorted | 38 (±4) | 20 (±4) | 1.9x | 4 / 3 |
| number float asc, input reversed | 47 (±2) | 20 (±3) | 2.3x | 5 / 3 |
| number with NaN asc | 131 (±10) | 106 (±12) | 1.2x | 5 / 6 |
| 2 keys: text asc, int desc | 422 (±13) | 135 (±8) | 3.1x | 5 / 8 |
| 2 keys: int asc, text asc | 314 (±21) | 143 (±11) | 2.2x | 6 / 10 |

Peak memory is the peak resident set size above the size before the run, sampled every 2 ms from a
worker thread. It includes garbage that the collector has not yet freed. The keyed sort needs about
40 bytes per row for one number column (keys 8, order and key buffers with spares 24, result 8). A
text column adds about 60-90 bytes per distinct string (the map, the sorted array, the ranks), close
to what the old decorated sort used.

## Results: end to end in the grid (dev server, 1M rows, click to first sorted frame)

`scripts/perf-sort.mjs` on `/dev/sort-bench`, 3 runs per cell, development build (React runs slower
than in production), other work on the machine. The baseline ran the same server with the old sort
files swapped in.

| Column | Baseline median ms | Now: range of medians over two batches ms |
| --- | --- | --- |
| Name (text, 25 distinct values) | 551 | 168-279 |
| Score (number) | 523 | 138-215 |

At 100k rows the Name column went from 132 ms to 36-105 ms. The rest of the click-to-frame time is
React and the store, not the sort.

## Results: live updates into a sorted 1M-row view

Assumptions: 1,000 single-cell patches per second to random rows, on the `score` column that the
view sorts by (or the `name` column for the last row); the same seeded stream drives both
implementations and both stores must end on the same view. "Deferred" is the default
`reorder`; "immediate" re-places the patched rows. Unit: main-thread ms spent per second of updates.

| Case | Baseline ms/s (MAD) | Now ms/s (MAD) | Speedup |
| --- | --- | --- | --- |
| live, deferred (default), 10 batches x 100, sort column | 22 (±1) | 23 (±0) | 1.0x |
| live, immediate, 10 batches x 100, sort column | 1591 (±286) | 314 (±17) | 5.1x |
| live, immediate, 1000 x 1, sort column | 46584 (±906) | 24161 (±1228) | 1.9x |
| live, immediate, 1000 x 1, filtered view, sort column | 24175 (±3190) | 14561 (±94) | 1.7x |
| live, immediate, 1000 x 1, non-sort column | 43118 (±2160) | 1844 (±10) | 23.4x |

Ticks of 100 rows (10 per second) cost about 31 ms each with `"immediate"`, and a single-row tick
cost 9 ms on a quiet machine (24 ms in the run above). What remains is O(n) work that the store's
immutable arrays require: the `data` array copy on every tick (about 1.6 ms at 1M) and the copy of
the order array when a row moves. At 100,000 rows the same scenario measured 1.3 ms for a one-row tick and 4 ms for a 100-row tick (about 1,300 ms/s for 1,000 one-row ticks and 41 ms/s for ten 100-row ticks). A feed of 1,000 separate one-row ticks per second cannot reach a
small ms/s figure at 1M rows without changing those arrays.

## Comparing with an external table

The maintainer supplied a table from another grid (conditions unknown: machine, data, what is
timed). It is a reference point, not a target to match. On dataset-shaped rows (25 distinct
names, scores 0-99; the `dataset:` rows above) the 1M number sort takes 83-89 ms and the text sort
93 ms here; the filter at 1M rows takes 73-77 ms and did not change. No claim of equivalence is
made, and public copy does not state a 1M-row figure for the whole interaction.

## Tried and dropped, with cost and benefit

| Technique | Verdict |
| --- | --- |
| Radix sort on number keys | Kept. 11-28x at 1M, about 40 bytes per row, about 150 lines. |
| Dense ranks of distinct strings for text | Kept. 2.8-8x. Costs a string map; already-sorted text input got 0.8x slower at 1M (the map pass costs more than the old run detection). |
| Collation keys for mostly unique text (ASCII fast path, normalized key strings sorted with `<`, then a verifying pass) | Dropped. Unique strings gain only 1-2x without it, and the key table depends on the locale (contractions), so it needs a verify-and-fall-back layer. More code and risk than the maintainer asked for. |
| 32-bit keys for small integers, an already-sorted early exit | Dropped. Saves about 20-40 ms at 1M; extra branches for no clear need. |
| Keying `date`, `select`, `checkbox`, `url`, and `longText` columns | Not done. Their comparators stay on the old path; a select column is now the slowest typed sort relative to number. |
| Cache of the unfiltered sorted order for filter-only changes | Dropped. A filter change sorts only the surviving rows, which is already cheaper than the full sort, and the cache would hold 8 bytes per row per grid. |
| Worker thread for the sort | Dropped. The sort is under 0.2 s for numbers; a worker needs the row data copied across threads. |
| Position map for live updates | Dropped. Costs 4 bytes per row plus upkeep on every move; the `indexOf` scan is 0.5 ms at 1M. |
| Coalescing `"immediate"` ticks inside one frame | Not done. It changes the documented "moves now" contract; propose it as a separate option if needed. |

## Equivalence

`sort-filter/keyed-sort.test.ts` compares the new order with a verbatim copy of the old comparator
sort for 10 column kinds (mixed case, accents, empties, duplicates, -0, NaN, strings in number
columns, values above 1e300, hostile values), both directions, 1-3 sort keys, sorted and reversed
input, filtered subsets, and consumer-replaced cell types. `store/live-update-order.test.ts`
checks the store view against a full re-sort after every batch of 1, 2, 5, and 40 patches, with
and without a filter, and for a derived sort column.
