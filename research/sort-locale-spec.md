# sortLocale spec

Decision record for the sort language of the grid. As built.

## Problem

`localeCompare` and `Intl.Collator()` with no argument follow the language of the runtime. The server render and the browser then order the same rows differently (`ä` after `z` under `sv`), and hydration shows a reorder.

## Decisions

- `sortLocale` (a BCP 47 tag on `DataGridSyncProps`) defaults to the `locale` prop, then `"en-US"`. The server and the browser order rows alike. `locale="de-DE" sortLocale="en-US"` formats German and sorts en-US.
- The tag decides every built-in text compare: the `text`, `longText`, `url`, `select`, and `lookup` types, and a column with no `type`. It decides the text range filters (`gt`, `gte`, `lt`, `lte`, `between`) and the value lists of the header filter and the filter builder.
- The collator is `Intl.Collator([tag, "en-US"], { numeric: true, sensitivity: "base" })` (and a plain variant for the `text` type). A malformed or unsupported tag falls back to `"en-US"` with one development warning per tag. At most 20 collators and 20 warnings stay.
- `sortLocale` reaches the compares through a scope (`withSortLocale`) that the view build opens. The scope is synchronous. A callback that returns a promise leaves the scope at its first `await` and warns once in development.
- Two SDK exports serve plugin and cell type authors: `sortCollator()` returns the collator in scope (`"en-US"` outside a scope), and `withSortLocale(locale, run)` opens a scope for code that runs outside the view build.

## Modes

- Client and client pagination: the prop decides the order of the window or the page.
- `sortMode="server"`: the grid sends the `SortSpec` and never reorders. The server owns the order. `sortLocale` (or `locale`) still decides the value lists of the filters.
- Lazy (scroll) rows: no client sort, so no effect on rows.
- URL state and saved views store specs, not an order, so the locale is not part of them.

## Upgrade path

A developer who relied on the runtime language keeps it with `sortLocale={navigator.language}` after mount, or with a column `sortCompare`.
