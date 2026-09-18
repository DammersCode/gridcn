# Import-dialog UX + configuration (workplan #75)

User asks (2026-08-01): (1) in the Map-columns step, a quick X button per row to set that
column to "skipped"; (2) make the dialog configurable — consumers change default skip
behavior, force a default delimiter, toggle delimiter auto-detect, and similar defaults.

Current state: import-dialog.tsx already has per-column mapping Selects with a `__skip__`
option and a delimiter Select fed by auto-detection in parse-import-file.ts. This is UX +
options plumbing, not new machinery.

## 1. Quick-skip X button

- Each mapping row gains a small ghost icon button (X) after the Select: click = set mapping
  to skipped (same code path as choosing `__skip__`). Hidden (or disabled) when the column is
  already skipped. aria-label from a new `labels.io.skipColumnQuick` string (i18n group grows
  by one; de/en defaults).
- Keyboard: normal button semantics; no new keymap.

## 2. `importOptions` configuration object

One optional prop, threaded from the consumer surface (`useDataGridImport` options and the
`<DataGridImportButton>`/dialog props — follow the existing options flow):

```ts
type ImportDialogOptions = {
  /** Skip auto-detect and preselect this delimiter. Detect still runs if undefined. */
  defaultDelimiter?: CsvDelimiter;
  /** false disables delimiter auto-detection; defaultDelimiter (or ",") is used. Default true. */
  autoDetectDelimiter?: boolean;
  /** Default for the header-row toggle. Default true (current behavior). */
  defaultHeaderRow?: boolean;
  /** Source columns to preselect as skipped: header names (case-insensitive) or indices. */
  defaultSkipColumns?: readonly (string | number)[];
  /** Override the initial mapping per source column; return undefined to fall back to the
   *  built-in matcher, null to skip. Wins over defaultSkipColumns. */
  mapColumn?: (header: string, index: number) => string | null | undefined;
};
```

- Semantics: options apply at PRESELECTION time only — the user can always override in the
  dialog. `mapColumn` runs after the built-in `match-import-column` matcher would (it replaces
  the matcher's answer when it returns non-undefined).
- No behavior change when the prop is omitted (all defaults = today's behavior; type-tested).
- Rejected as YAGNI for v1: per-column type-coercion overrides, custom delimiter strings
  beyond the existing three, persisted user preferences. Revisit on demand.

## Tests

Browser: X button skips a column and the Select shows Skip; defaultDelimiter preselects and
suppresses detect only when autoDetectDelimiter is false; defaultSkipColumns by name and by
index; mapColumn override wins. Unit: option plumbing + preselection logic pure-function
tests. Existing import flow tests stay green.

## Docs

import-export.mdx: the options object (AutoTypeTable if the type is exported), one short
example. Per the docs rules: example first, no walls, no meta-narration. Labels row in
i18n.mdx coverage table.
