# Uncontrolled data mode: `defaultData` (workplan #45, user question 2026-07-18)

## Problem

Every example and the quick start carry state boilerplate (`useState` + `onDataChange`, or
`useDataGridState` which drags the history add-on in). The user's question: why isn't owning
the data the grid's default? Answer: controlled-by-default is correct (the app must see edits;
server sync/undo/import need an app-side source of truth; React convention) — but the standard
uncontrolled OPT-IN (`<input defaultValue>` analog) is missing from core.

## Design

- New `defaultData?: readonly TData[]` on `DataGrid`/`DataGridProvider`. Mutually exclusive
  with `data`: when `defaultData` is set, the store seeds from it once and OWNS the row array
  (edits/paste/fill/delete/row-ops update it internally); `onDataChange` still fires as a
  notification (optional). When `data` is set, today's controlled behavior, unchanged.
- Passing both → dev-mode console.warn, `data` wins (controlled), matching React's
  value/defaultValue semantics.
- Implementation: store already routes every mutation through one commit path that computes
  `next` before calling `onDataChange` — uncontrolled mode applies `next` to internal state
  there. Keep the erasure-boundary typing rules; no new re-renders beyond what a controlled
  parent would have caused (the store swap is the same set()).
- `useDataGridState` (history add-on) remains the undo/redo-bundled convenience; its docs note
  it now differs from plain `defaultData` only by history.

## Consumer-facing outcome

Minimal grid, zero state wiring:
`<DataGrid defaultData={rows} columns={columns} getRowId={getRowId} className="h-[240px]" />`

## Sweep

- Quick start (already being minimized, #45): uses `defaultData`, no useState, core install only;
  undo/redo demoted to an optional section at the end.
- data-grid-minimal-demo (new example): switches to `defaultData`.
- Example sweep: switch other examples to `defaultData` ONLY where their state serves no
  demonstrative purpose (keep useState where the example is ABOUT reacting to data — events
  demo, lazy, io import, history). List per-example verdicts in the report.
- Docs: api-reference (prop + exclusivity), events-state page's triad table (data slice gains
  "uncontrolled opt-in"), quick-start prose explains the controlled default in one sentence
  with a link for when you need your own state.

## Tests

Uncontrolled: edit/paste/delete mutate the internal array (visible in the DOM) with NO data
prop; onDataChange still notifies; both-props warning fires once and data wins; controlled
behavior byte-identical to today (existing suites are the proof).

## Sequencing

Blocked behind workplan #44 (the fling-smoothness planner lane owns store.tsx/root.tsx right now).
One lane lands defaultData + quick-start rewrite + example sweep together.
