---
name: gridcn-custom-cell-type
description: "gridcn custom cell types: the CellType contract, registration, and typing. Use when adding a cell type (currency, rating, tags, color), or when a custom `type` renders as plain text, opens no editor, or breaks on paste, fill, or sort."
---

A cell type is one object: `{ Cell, Editor, toText, fromText, clearValue, isEmpty, compare?, align? }`. Clipboard, fill, quick-clear, search, sort, and import/export all run through this contract, so getting one method wrong breaks every consumer of the type, not just the visible cell.

Scope: one cell type, from value pipeline to registration. Auditing a slow grid → `gridcn-performance`.

## 1. Symptom check first, if you were sent here by a bug

- **Column renders as plain text, editing does nothing** → the `type` key does not match a key in the registry you passed to `cellTypes`. The lookup falls back to the built-in `text` type silently, with no warning (installed `components/data-grid/cell.tsx`: `cellTypesRegistry[column.type ?? "text"] ?? cellTypesRegistry["text"] ?? defaultCellTypes.text`). Fix the key, or check step 4.
- **Every built-in-typed column (number, date, select, checkbox) broke after adding a custom type** → the `cellTypes` prop replaced the registry instead of extending it. Go to step 4.
- **Paste throws or aborts the whole paste** → `fromText` threw. Go to step 2.
- **A popover/portal editor (date-picker, combobox, color picker) closes the instant you click into it** → go to step 6, `data-grid-cell-editor`.
- **Values look right on screen but sort/search/fill act on the wrong thing** → you conflated `toText`/`toDisplayText` with the raw value. Search and filter always match raw `String(value)`, never `toText`; sort's default (no `compare`) is a numeric-aware collation of that same raw string. See `custom-cell-types.md#value-pipeline`.

## 2. Design the value pipeline before writing any component

- Storage type is a serializable primitive (a plain string/number/boolean, or `null`) — never a class instance (`Date`, `Decimal`, a custom `Money`). This keeps `compare` a plain comparison and clipboard/JSON round-trips trivial.
- `toText` is the canonical, unformatted serialization. It must round-trip: `fromText(toText(v))` reproduces `v` for every value the type can hold. Clipboard copy and export call `toText` unconditionally.
- `fromText` must never throw. Paste and import feed it arbitrary text (a stray clipboard fragment, another tool's export, a typo). Anything unparseable returns `clearValue()`'s result, not `undefined` and not a thrown error — one bad cell degrades, the rest of the paste keeps going.
- `clearValue()` is the type's empty value (`""`, `null`, `false`, …). Quick-clear delete, `fromText`'s garbage fallback, and fill-clear all call it.
- `isEmpty` is a semantic choice, not a technicality — decide it deliberately, it is not implied by `clearValue`. It gates what a Ctrl+A region treats as blank and what the fill handle treats as a fillable gap. Precedent: for `number`, `0` is not empty (only `null` is); for `checkbox`, `false` is not empty (only `null` is). A column that treats a real `0` as empty makes the fill handle skip it.
- `toDisplayText` is optional and display-only: locale-formatted dates, currency symbols, and similar. It is never round-tripped and never read by clipboard, export, search, or filter — only the on-screen render uses it (fallback: `toDisplayText ?? toText`, via the `displayText()` helper from the barrel). Keep `toText` plain and parseable so a decorative display format can never leak into an export or break a later paste.
- `compare` is optional; omit it only if the default (numeric-aware collation of the raw `String(value)`) is correct for the type. It only ever receives two non-empty values — empty placement (per `isEmpty`) is handled outside it, sorting last in both directions.
- `align` is `"left" | "right" | "center"`, for the default `Cell` rendering only; pair `"right"` with `tabular-nums` for numeric-like types.

Completion for this step: you can state, in one sentence per method, what `toText`, `fromText`, `clearValue`, and `isEmpty` do for a garbage/empty/typical value — before writing `Cell` or `Editor`.

## 3. Build `Cell` and `Editor`

- `Cell` is a hot path: it renders once per visible cell on every window mount, and mounts happen continuously during scroll. Hoist and cache anything expensive (an `Intl.Format*` instance, a parsed regex) outside the component — never construct it inside `Cell`. Key the cache on serialized options (for example `` `${locale}|${JSON.stringify(options)}` ``), never on object identity: a column's `options` literal is commonly re-created every render, so an identity-keyed `Map` never hits.
- Pin locales explicitly in any `Intl.DateTimeFormat`/`Intl.NumberFormat` you construct. Passing no locale falls back to the runtime's default, which commonly differs between Node SSR and the browser — same column, different rendered text, and a React hydration mismatch.
- `Editor` receives `{ value, initialText?, row, column, onChange, commit, cancel, pending?, rejectionCount? }`. `commit(movement?)` writes the value and tells the grid where the active cell goes next; `cancel()` discards the edit — it must never call `onChange`. Enter commits with `{ dx: 0, dy: 1 }` (moves down); blur/click-away/an explicit pick commits with `{ dx: 0, dy: 0 }` (stays put); Escape only calls `cancel()`.
- Guard against a double commit: an editor typically has at least two paths that can end it (Enter, then the blur that follows it; React StrictMode's dev double-invoke). Use `useCommitGuard` (from the barrel) — a one-shot latch, `true` once, `false` after — in every editor with more than one commit path.
- Seed focus and the caret from `initialText` (type-to-replace) with `useSeedFocus` (from the barrel).
- If the column's `validate` can be an async Standard Schema, honor `pending` (mark the input `readOnly`, never `disabled` — a disabled input swallows Escape and blocks cancellation) and re-arm your commit guard off `rejectionCount`, not off `pending` clearing (it also clears on Escape, right before unmount).
- Build editor UI from the project's shadcn primitives (`Input`, `Select`, `Popover`, `Calendar`, …) under `@/components/ui/*` — check the consumer's actual alias in `components.json` if unsure — to match the built-in types' look.

Completion for this step: Enter commits and moves down, Escape cancels without calling `onChange`, and a rapid Enter-then-blur or a StrictMode double-mount commits exactly once.

## 4. Register the type without breaking the built-ins

`cellTypes` on `DataGridProvider` **replaces** the whole registry, it does not merge into it:

```tsx
import { cellTypes } from "@/components/data-grid/data-grid"; // barrel path — adjust to your alias

<DataGridProvider {...grid} columns={columns} cellTypes={{ ...cellTypes, currency: currencyCellType }} />
```

Omit the spread and every built-in-typed column (`text`, `number`, `checkbox`, `select`, `date`) silently falls back to plain text — no warning. The registry itself is untyped (`Record<string, AnyCellType>`): a mistyped key compiles and renders as `text` with a dead editor, also with no warning. If a column renders as text and you already spread the built-ins in, the `type` string does not match a key in the object you built — recheck the key, not the component.

Completion for this step: every pre-existing built-in-typed column on the grid still edits correctly after adding the custom type.

## 5. Wire the type into the type system

Augment `GridCellTypes` by declaration merging, at the module path your `components.json` alias actually resolves to (default install: `@/components/data-grid/types`):

```ts
declare module "@/components/data-grid/types" {
  interface GridCellTypes {
    currency: { value: number | null; options: { currency: string } };
  }
}
```

Without this, `type: "currency"` still works at runtime, but `defineColumns` cannot narrow `options` or the column's value type — you lose the compile-time catch for a typo in an option key or in the type key itself. Cast `column.options` to your declared options type inside `Cell`/`Editor` (the cell props carry it erased): `column.options as CurrencyOptions | undefined`.

Completion for this step: `defineColumns` on a column with `type: "currency"` infers `options: { currency: string }` and the row's value as `number | null`, and an unknown option key is a type error.

## 6. Portaled editors only: keep outside-click from ending the edit

A `Popover`/`Select`/similar editor content portals to `document.body`, outside the cell's DOM subtree — but React re-dispatches its events through the *logical* (component-tree) parent, so a click inside the floating content still reaches the grid's outside-click handler unless you mark it. Add `data-grid-cell-editor=""` to the portaled content (`PopoverContent`, `SelectContent`, or equivalent):

```tsx
<PopoverContent data-grid-cell-editor="">{/* editor UI */}</PopoverContent>
```

Skip the attribute and picking a value looks like a click-away: it commits or cancels before the user can interact with the popover. An explicit pick should commit; closing any other way (outside click, focus loss, Tab, Escape) should `cancel()`.

Completion for this step: clicking inside the open popover/dropdown does not close or commit the edit; only an explicit pick or Escape/outside-click does, per the rule above.

## Done when

- The column renders with the new `type` and shows the expected display text (`toDisplayText ?? toText`).
- `fromText(toText(v))` reproduces `v` for a representative value — check it in a unit test on the plain functions, no rendering needed.
- Pasting an unrelated string (`"not a value"`) into the column does not throw, and the cell ends up holding `clearValue()`'s result.
- Opening the editor, typing, and pressing Enter commits and moves down; Escape leaves the original value in place; a fast Enter-then-blur or a dev StrictMode remount does not double-commit.

## Reference

Full contract, the built-in types' lessons (value pipeline, rendering/performance, editor UX, typing), and a complete worked `currency` example: `https://gridcn.vercel.app/docs/custom-cell-types.md`. Editing activation, keyboard contract table, and validation interaction: `https://gridcn.vercel.app/docs/editing-cell-types.md`. Exact contract types (`CellType`, `CellRenderProps`, `CellEditorProps`): `https://gridcn.vercel.app/docs/api-reference.md#celltypetdata-tvalue-toptions`. Shorter minimal sketch: `https://gridcn.vercel.app/docs/recipes.md#custom-cell-type`.
