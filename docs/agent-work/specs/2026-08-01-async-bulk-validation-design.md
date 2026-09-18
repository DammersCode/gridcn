# Async Standard-Schema validation on bulk paths (workplan #79)

User go (2026-08-01). Today paste/fill/import/streaming run sync validators and dev-warn +
pass-through on async schemas. Goal: async schemas validate on bulk paths too.

## Design

- Bulk pipeline gains an async branch: when any touched column's validator is a Standard
  Schema whose `validate` returns a Promise, the batch is HELD (not committed), all cell
  validations run with CHUNKED concurrency (cap ~32 in flight — thousands of cells must not
  spawn thousands of simultaneous promises), then the batch applies in ONE commit with the
  existing skip-on-reject semantics (failing cells drop silently, exactly like sync bulk).
- Transforms: committed value is result.value, same as single-cell.
- Race guard: a per-surface generation counter (the editor async pattern reused) — a newer
  conflicting operation (new paste over the same area, data replacement, sort/filter change
  that would invalidate targets) drops the pending batch silently. Targets are rowId-keyed so
  reorders alone do NOT invalidate.
- Sync-only batches: zero behavior change, zero new allocation on that path (perf contract).
- Streaming (`updateCells`): same mechanism; `skipValidation: true` remains the trusted-feed
  fast path. Deferred reorder semantics unchanged — validation resolves BEFORE patches apply,
  so viewStale/defer logic sees only validated values.
- UI affordance: none required for v1 of this feature (bulk paste today gives no per-cell
  progress either); the dev-warn about unsupported async bulk DISAPPEARS. If a batch takes
  visibly long that is the consumer's schema's latency — document it honestly.
- Import (io add-on): build-imported-rows awaits the same way; the import dialog's existing
  pending affordance covers the wait.

## Tests

Unit: async batch pass/fail mix (only passing cells commit), transform committed, chunking
respects the cap, generation guard drops stale batches, sync-only path untouched (identity
of behavior + no async machinery invoked — probe). Browser: paste with an async schema column
commits after resolution; a second paste before resolution supersedes the first; fill +
import equivalents; streaming updateCells with async validator.

## Docs

editing-cell-types.mdx: bulk-limitation callout REPLACED by the supported behavior (chunked,
skip-on-reject, supersede semantics). clipboard.mdx callout updated. Register row flips.
NO CHANGELOG (paused).
