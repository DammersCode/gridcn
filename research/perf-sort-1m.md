# Client-side sort at 1,000,000 rows

Goal: sort 1,000,000 rows by a text column and by a number column clearly faster, with identical
results. Method: measure first, profile, then change. Every number below comes from
`scripts/bench-sort.mjs`, which runs the baseline commit (`bb190349`) and the current code
alternately in one process on the same seeded rows, checks that both return the same order, and
reports the median and the median absolute deviation (MAD) of 5 runs (7 at 100k) after 2 warm-ups.

Machine: Windows 11 desktop, Node 24.15, remote desktop session off, measured on 2026-11-04 from
15:55 (other sessions of the repository were running tests on the same machine). Earlier runs taken
with the remote desktop session on are discarded: they ran 1.3-2x slower and noisier. Row counts are
stated per table: **1M** is 1,000,000 rows, **100k** is 100,000 rows.

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
| dataset: number (score) asc | 383 (±8) | 52 (±4) | 7.4x | 42 / 61 |
| dataset: number (age) desc | 472 (±5) | 44 (±2) | 10.7x | 43 / 56 |
| dataset: text (name) asc | 576 (±5) | 50 (±1) | 11.4x | 45 / 54 |
| dataset: filter age >= 30, no sort | 53 (±1) | 53 (±3) | 1.0x | 50 / 50 |
| dataset: filter name contains, no sort | 71 (±1) | 68 (±1) | 1.0x | 36 / 36 |
| text asc | 3486 (±113) | 1200 (±40) | 2.9x | 42 / 60 |
| text desc | 3079 (±148) | 1086 (±100) | 2.8x | 42 / 60 |
| text asc, input sorted | 316 (±13) | 440 (±26) | 0.7x | 38 / 85 |
| text asc, input reversed | 546 (±6) | 408 (±4) | 1.3x | 39 / 75 |
| text (no cell type) asc | 2600 (±67) | 1329 (±30) | 2.0x | 47 / 85 |
| digits asc | 2270 (±102) | 739 (±56) | 3.1x | 42 / 90 |
| number int asc | 735 (±7) | 54 (±1) | 13.6x | 43 / 61 |
| number int desc | 797 (±1) | 49 (±5) | 16.2x | 44 / 61 |
| number float asc | 1869 (±33) | 62 (±1) | 30.2x | 44 / 60 |
| number float desc | 1910 (±52) | 64 (±1) | 29.8x | 42 / 68 |
| number float asc, input sorted | 271 (±29) | 119 (±6) | 2.3x | 38 / 60 |
| number float asc, input reversed | 240 (±7) | 117 (±14) | 2.1x | 38 / 61 |
| number with NaN asc | 750 (±25) | 664 (±6) | 1.1x | 41 / 61 |
| 2 keys: text asc, int desc | 3803 (±97) | 1000 (±63) | 3.8x | 43 / 115 |
| 2 keys: int asc, text asc | 3423 (±25) | 1000 (±25) | 3.4x | 43 / 107 |

## Results: sort step, 100k rows

| Case | Baseline ms (MAD) | Now ms (MAD) | Speedup | Peak RSS delta MB (baseline / now) |
| --- | --- | --- | --- | --- |
| dataset: number (score) asc | 34 (±1) | 4 (±1) | 7.7x | 3 / 0 |
| dataset: number (age) desc | 43 (±1) | 5 (±0) | 9.0x | 3 / 0 |
| dataset: text (name) asc | 51 (±1) | 5 (±0) | 9.3x | 4 / 0 |
| dataset: filter age >= 30, no sort | 6 (±0) | 7 (±0) | 0.9x | 0 / 0 |
| dataset: filter name contains, no sort | 7 (±0) | 8 (±0) | 0.9x | 0 / 0 |
| text asc | 221 (±2) | 72 (±2) | 3.1x | 5 / 8 |
| text desc | 222 (±5) | 72 (±0) | 3.1x | 5 / 8 |
| text asc, input sorted | 24 (±1) | 21 (±1) | 1.2x | 4 / 7 |
| text asc, input reversed | 33 (±1) | 22 (±1) | 1.5x | 4 / 7 |
| text (no cell type) asc | 189 (±1) | 93 (±1) | 2.0x | 5 / 8 |
| digits asc | 107 (±3) | 51 (±1) | 2.1x | 5 / 13 |
| number int asc | 66 (±1) | 5 (±0) | 13.1x | 5 / 0 |
| number int desc | 66 (±1) | 4 (±0) | 15.4x | 5 / 0 |
| number float asc | 91 (±1) | 7 (±0) | 13.5x | 5 / 0 |
| number float desc | 94 (±3) | 7 (±0) | 13.2x | 5 / 0 |
| number float asc, input sorted | 17 (±0) | 9 (±0) | 1.9x | 5 / 0 |
| number float asc, input reversed | 17 (±0) | 9 (±0) | 1.9x | 4 / 0 |
| number with NaN asc | 67 (±1) | 61 (±1) | 1.1x | 5 / 6 |
| 2 keys: text asc, int desc | 281 (±25) | 87 (±11) | 3.2x | 5 / 8 |
| 2 keys: int asc, text asc | 523 (±38) | 192 (±17) | 2.7x | 6 / 11 |

Peak memory is the peak resident set size above the size before the run, sampled every 2 ms from a
worker thread. It includes garbage that the collector has not yet freed. At 1M rows the peak is
36-50 MB for the old and the new sort alike (about 40 bytes per row). By construction the keyed sort
holds 8 bytes of key per row and about 24 bytes of order and key buffers with spares, plus the 8-byte
result; a text column adds about 60-90 bytes per distinct string (the map, the sorted array, the
ranks), close to what the old decorated sort used.

## Results: end to end in the grid (dev server, 1M rows, click to first sorted frame)

`scripts/perf-sort.mjs` on `/dev/sort-bench`, 3 runs per cell, development build (React runs slower
than in production), other work on the machine. The baseline ran the same server with the old sort
files swapped in.

| Column | Baseline median ms | Now median ms |
| --- | --- | --- |
| Name (text, 25 distinct values), 1M rows | 292 | 87-89 |
| Score (number), 1M rows | 264 | 68 |
| Name (text), 100k rows | 49 | 37 |

Each cell is the median of 5 runs. The baseline ran between two runs of the new code (87 and 89 ms
for Name) to show drift. The rest of the click-to-frame time is React and the store, not the sort.

## Results: live updates into a sorted 1M-row view

Rows marked 1M or 100k give the grid size. Assumptions: 1,000 single-cell patches per second to random rows, on the `score` column that the
view sorts by (or the `name` column for the last row); the same seeded stream drives both
implementations and both stores must end on the same view. "Deferred" is the default
`reorder`; "immediate" re-places the patched rows. Unit: main-thread ms spent per second of updates.

| Case | Baseline ms/s (MAD) | Now ms/s (MAD) | Speedup |
| --- | --- | --- | --- |
| 1M: deferred (default), 10 batches x 100, sort column | 17 (±0) | 17 (±0) | 1.0x |
| 1M: immediate, 10 batches x 100, sort column | 1044 (±83) | 234 (±29) | 4.5x |
| 1M: immediate, 1000 x 1, sort column | 25034 (±891) | 15466 (±29) | 1.6x |
| 1M: immediate, 1000 x 1, filtered view, sort column | 38123 (±1257) | 13111 (±300) | 2.9x |
| 1M: immediate, 1000 x 1, non-sort column | 23584 (±1340) | 1390 (±76) | 17.0x |
| 100k: deferred (default), 10 batches x 100, sort column | 3 (±0) | 3 (±0) | 1.0x |
| 100k: immediate, 10 batches x 100, sort column | 147 (±8) | 31 (±12) | 4.7x |
| 100k: immediate, 1000 x 1, sort column | 2348 (±135) | 1908 (±256) | 1.2x |
| 100k: immediate, 1000 x 1, filtered view, sort column | 2394 (±127) | 1364 (±39) | 1.8x |
| 100k: immediate, 1000 x 1, non-sort column | 2771 (±176) | 173 (±6) | 16.0x |

A 100-row tick costs about 23 ms at 1M rows and about 3 ms at 100k with `"immediate"`; a one-row tick
costs about 15 ms at 1M and 1.6-1.9 ms at 100k. What remains is O(n) work that the store's immutable
arrays require: the `data` array copy on every tick and the copy of the order array when a row
moves. A feed of 1,000 separate one-row ticks per second cannot reach a
small ms/s figure at 1M rows without changing those arrays.

## Comparing with an external table

The maintainer supplied a table from another grid (conditions unknown: machine, data, what is
timed). It is a reference point, not a target to match. On dataset-shaped rows (25 distinct
names, scores 0-99; the `dataset:` rows above) the 1M number sort takes 44-52 ms and the text sort
50 ms here; the filter at 1M rows takes 53-68 ms and did not change; deferred live updates cost
17 ms/s and a 100-row `"immediate"` tick about 23 ms (10 ticks per second: 234 ms/s). The unit and
the workload behind the external figures are unknown, so no claim of equivalence is made, and public
copy does not state a 1M-row figure for the whole interaction.

## Tried and dropped, with cost and benefit

| Technique | Verdict |
| --- | --- |
| Radix sort on number keys | Kept. 7-30x at 1M, about 40 bytes per row, about 150 lines. |
| Dense ranks of distinct strings for text | Kept. 2-11x. Costs a string map; already-sorted text input got 0.7x slower at 1M (the map pass costs more than the old run detection). |
| Collation keys for mostly unique text (ASCII fast path, normalized key strings sorted with `<`, then a verifying pass) | Dropped. Unique strings gain only 1-2x without it, and the key table depends on the locale (contractions), so it needs a verify-and-fall-back layer. More code and risk than the maintainer asked for. |
| 32-bit keys for small integers, an already-sorted early exit | Dropped. Saves about 10-30 ms at 1M; extra branches for no clear need. |
| Keying `date`, `select`, `checkbox`, `url`, and `longText` columns | Not done. Their comparators stay on the old path; a select column is now the slowest typed sort relative to number. Accepted for 2.0. |
| Cache of the unfiltered sorted order for filter-only changes | Dropped. A filter change sorts only the surviving rows, which is already cheaper than the full sort, and the cache would hold 8 bytes per row per grid. |
| Worker thread for the sort | Dropped. The sort is under 0.2 s for numbers; a worker needs the row data copied across threads. |
| Position map for live updates | Dropped. Costs 4 bytes per row plus upkeep on every move; the `indexOf` scan is 0.5 ms at 1M. |
| Coalescing `"immediate"` ticks inside one frame | Not done. It changes the documented "moves now" contract; propose it as a separate option if needed. Accepted for 2.0. |

## Equivalence

`sort-filter/keyed-sort.test.ts` compares the new order with a verbatim copy of the old comparator
sort for 10 column kinds (mixed case, accents, empties, duplicates, -0, NaN, strings in number
columns, values above 1e300, hostile values), both directions, 1-3 sort keys, sorted and reversed
input, filtered subsets, and consumer-replaced cell types. `store/live-update-order.test.ts`
checks the store view against a full re-sort after every batch of 1, 2, 5, and 40 patches, with
and without a filter, and for a derived sort column.
