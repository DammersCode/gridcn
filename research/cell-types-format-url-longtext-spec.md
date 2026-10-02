# Spec: number format, `url` and `longText` cell types (W6-04, FEAT-3)

## Goal

Three built-in cell-type additions: locale number formatting for display (currency, percent,
compact), a `url` type that renders a safe link, and a `longText` type with a multi-line popover
editor. Stored values and their text form (`toText`) stay raw, so copy, export, sort, and filter
keep working on the real value.

Written against the API after Wave 5: cell-type-driven behavior (W5-06), `useCellEditor` for the
built-in text editors (R-49), `CellRef` ctx (W5-08), commands (W5-10).

## Decisions

1. **Format is display only.** `number.options.format` feeds `toDisplayText`; `toText`
   (`cell-types/number.tsx:148-151`) stays `String(value)`. Rationale: copy, CSV/XLSX export, and
   paste round-trip the number, not `"$1,234.00"`. Rejected: formatting `toText` — a currency
   symbol or a grouping comma breaks `fromText` (`normalizeNumberText`, `number.tsx:11-13`, turns
   the first comma into a dot).
2. **Formatter cache keyed on the options object.** A module `WeakMap<Intl.NumberFormatOptions,
   Intl.NumberFormat>` in front of the date-style string-keyed `Map` (`date.tsx:89-99`). Rationale:
   the per-cell cost is one `WeakMap` lookup; the date cache runs `JSON.stringify` on every cell
   render (`date.tsx:92`). Rejected: a new `Intl.NumberFormat` per render (the date cache measured ~38 µs per build).
3. **`url` links only through one allow-list.** A new optional `CellType.href?(value, options):
   string | null` member; the grid passes every result through `safeHref()` before it renders or
   opens it. `safeHref` accepts `http:`, `https:`, and `mailto:` only. Rationale: a custom type
   cannot widen the list, so no type renders a `javascript:` link. Rejected: a per-column protocol
   option — a widening option is an injection switch.
4. **The cell link is not a tab stop.** `<a tabIndex={-1} draggable={false}>`; a new built-in action
   `openLink` (default `alt+Enter`, free in `keyboard/default-keymap.ts:9-63`) opens the active
   cell's `href`. Rationale: grid focus is roving (one focusable cell); a link per cell would add
   thousands of tab stops. Rejected: Enter opens the link — Enter is `edit`/`commitDown`.
5. **`longText` edits in a popover.** The cell stays one line; the editor is a `<textarea>` in a
   `Popover` marked `data-grid-cell-editor` (the date editor pattern, `date.tsx:154-208`).
   Rejected: growing the row — row heights are fixed (W6-13 owns variable heights).

## API

```ts
// types.ts — GridCellTypes additions
number: { value: number | null; options: { min?; max?; step?; decimals?;
  format?: Intl.NumberFormatOptions; locale?: string } };   // locale default "en-US"
url: { value: string | null; options: { label?: (value: string) => string } };
longText: { value: string; options: { maxLength?: number; placeholder?: string } };

// CellType
href?(value: TValue, options?: TOptions): string | null;

// cell-types/safe-href.ts (core, on the consumer barrel)
export function safeHref(raw: string): string | null;
```

`BuiltinCellTypeKey` (`cell-types/cell-types.ts:22`) and the `cellTypes` object gain `url` and
`longText`; `urlCellType`, `longTextCellType`, and `safeHref` join the cell-types barrel.

## Behavior

- **Number format.** `toDisplayText = formatter.format(roundToDecimals(value))`. With `decimals` set
  and no fraction-digit option in `format`, the formatter uses `decimals` for both minimum and
  maximum fraction digits. The editor seeds its draft with `toText` (raw), so `0.25` under
  `style: "percent"` edits as `0.25`. A `RangeError` from `new Intl.NumberFormat` (for example
  `style: "currency"` without `currency`) falls back to `toText` and dev-warns once per options
  object. Quick search keeps `toText` (raw digits).
- **url.** `toText`/`fromText` are the trimmed string; `href = safeHref(value)`. A value that fails
  the allow-list renders as plain text (no link, no error). The link has `target="_blank"`,
  `rel="noopener noreferrer nofollow"`, `referrerPolicy="no-referrer"`. `options.label` maps the
  stored URL to the shown text; `toText` stays the URL. A press on the link selects the cell
  (pointerdown bubbles to `onCellPointerDown`, `use-grid-interaction.ts:911`) and the click opens
  the link; a press elsewhere in the cell only selects. `openLink` is a no-op when the active
  cell's type has no `href` or `safeHref` returns `null`; on a lazy hole it is a no-op.
- **longText.** The cell renders `CellSpan` with the first 500 characters and line breaks shown
  as spaces. Editor keys: Enter commits and moves down, Shift+Enter and Alt+Enter insert a line
  break, Escape cancels, closing the popover by an outside press commits. `maxLength` (default
  100,000) is the textarea `maxLength` and the type's default `validate`, so paste, fill, and
  import reject longer values with a message.
- **readOnly / editing / plugins.** No new rules: `openLink` reads data only, so it runs in a
  read-only grid and while no edit session is open (`scope: "grid"`). The edit guards
  (W5-12 store readOnly) cover both new editors.
- **Filter.** `url` and `longText` declare `filter: { operators: TEXT_FILTER_OPERATORS,
  valueInput: "text" }` (`cell-types/capabilities.ts:5-15`). Number keeps its current operators.

## Security

- `safeHref`: reject input longer than 2,048 characters; strip nothing (the URL parser already
  removes leading control characters and tabs); `new URL(raw)` without a base, so relative and
  scheme-less values return `null`; accept only `protocol ∈ { "http:", "https:", "mailto:" }`;
  return `url.href` (the normalized form), never the raw text. Tests cover `javascript:`,
  `JaVaScRiPt:`, `\tjavascript:`, `java\0script:`, `data:`, `vbscript:`, `file:`, and `//evil`.
- `window.open(href, "_blank", "noopener,noreferrer")` for `openLink`, so the opened page gets no
  `window.opener`.
- Export: CSV formula neutralizing (W2-18, `sanitizeFormulas` on by default) already covers a
  `=HYPERLINK(…)` value; XLSX writes string cells only (R-62), so no hyperlink cell is created.
- `longText` caps rendered text at 500 characters and stored text at `maxLength`, so one huge
  pasted value cannot stall layout.

## Performance

- Number: one `WeakMap` hit plus one `format` call per rendered cell; nothing runs per row of
  data. Search, sort, filter, and export never format.
- url: `safeHref` runs once per rendered cell (URL parse, ~1 µs); `openLink` runs it once.
- No new work for columns of other types.

## Accessibility

- The link carries the cell's text as its name; the cell keeps `role="gridcell"`. The `openLink`
  binding is listed in the keybindings dialog under `"other"` via `labels.actions.openLink`.
- The `longText` textarea gets `aria-label` from `columnLabelText(column)`, `aria-multiline`, and
  `dir="auto"` (the text editor rules, `text.tsx:39-42`).

## Files

- Change: `types.ts` (`GridCellTypes`, `CellType.href`, `GridActions.openLink`),
  `cell-types/number.tsx`, `cell-types/cell-types.ts`, `cell-types/index.ts`, `data-grid.tsx`
  (barrel), `keyboard/default-keymap.ts`, `interaction/use-grid-interaction.ts` (`openLink` case),
  `labels.ts`, `data-grid-keybindings/action-groups.ts`.
- Add: `cell-types/url.tsx`, `cell-types/long-text.tsx`, `cell-types/safe-href.ts`, and their tests.
- `registry.json`: three new files in the `data-grid` item; payload rebuild.

## Docs, registry, CHANGELOG

- `editing-cell-types.mdx` "Built-in cell types": `format`/`locale`, `url`, `longText` rows and
  editor keys; a warn callout that only `http`, `https`, and `mailto` render as links.
- `custom-cell-types.mdx`: the `href` member and that `safeHref` filters it.
- `keybindings.mdx`: `openLink`. Cell-types demo gains a price, a link, and a notes column.
- CHANGELOG `### Added`: number `format`, `url`, `longText`, `CellType.href`, `safeHref`, `openLink`.

## Test plan

- Unit `number.test.ts`: currency, percent, compact output with `locale`; `decimals` fills the
  fraction digits; `toText` stays raw; copy and CSV export of a formatted column give raw numbers;
  invalid `format` falls back with one warning; one formatter per options object (spy).
- Unit `safe-href.test.ts`: the security list above plus a 2,049-character URL → `null`.
- Unit: `openLink` calls `window.open` with `noopener,noreferrer` for a safe value, and does
  nothing for an unsafe value, a non-url column, or a lazy hole; it runs in a read-only grid.
- Browser: link click opens and selects; dragging from a link extends a range (no native link drag);
  `longText` editor keys (Enter, Shift+Enter, Alt+Enter, Escape, outside press);
  `maxLength` rejection on paste.
- Perf: 100k-row number column with `format` keeps the `perf.browser` scroll FPS ratio.

## Dependencies

W3-03 (number stepping, done), W5-06 (type-driven filter), R-49 (`useCellEditor` in built-ins),
W5-10 (`openLink` as a built-in action listed by the dialog).

## Product decisions (maintainer, 2026-10-02)

- Quick search stays on raw digits, never the formatted number: formatting 100k values per
  keystroke costs ~100 ms, and users type digits.
- The editor edits the raw value (a stored `0.25` edits as `0.25` under `style: "percent"`), the
  same form as copy and paste; a consumer who wants another edit form writes a custom type.
