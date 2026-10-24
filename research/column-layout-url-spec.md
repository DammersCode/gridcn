# Spec: column layout in the URL (W6-07, API-03)

Status: implemented in 1.2.0.

## Goal

`useDataGridUrlState` syncs the column layout to the URL next to sort, filter, join, and search, so
a shared link restores the column order and the hidden columns. Each layout part is opt-in; the
URL is written at gesture commit points only, and every URL value is bounded and normalized.
Today the docs say "Column layout is not synced to the URL" (`content/docs/addons/url-state.mdx:147-151`).

Written against the API after Wave 5: W5-11 `setColumnLayout`, `state.columnLayout`, and
`normalizeColumnLayout` (`research/controlled-selection-layout-spec.md` decisions 8-11).

## Decisions

1. **Per-part opt-in, default `order` + `hidden`.** Rationale: order and visibility are what a
   shared view means; widths depend on the viewer's screen, and pins depend on its width.
   Rejected: one opaque layout param — the user cannot share order without widths.
2. **A part is in the URL only when it differs from the column defs.** An absent param means "the
   def default for this part"; a re-apply with an absent param resets that part. Rationale: short
   links, and a link made before a column was added still shows that column (the normalizer
   appends missing ids, W5-11 decision 9). Rejected: always writing every opted-in part — every
   link carries the full column list.
3. **Write-back at commit points through `state.columnLayout`.** The hook subscribes to the W5-11
   snapshot and writes the opted-in parts that changed. This spec requires that the snapshot
   change identity only at commit points and controlled applies, never on `setColumnWidth` drag
   frames (W5-11 decision 10 keeps that action live-only). Rejected: a debounce over live widths —
   a slow drag would still write mid-gesture.
4. **Apply through `setColumnLayout`.** URL input goes through the one normalizer (unknown ids
   dropped, missing ids appended, widths clamped, unpinnable pins dropped). Rationale: one bounds
   check for prop, action, and URL. Rejected: a URL-only parser that writes `columnOrder` directly.

## API

```ts
type UrlLayoutPart = "order" | "hidden" | "widths" | "pins";
type UseDataGridUrlStateOptions = {
  prefix?: string;
  layout?: readonly UrlLayoutPart[];   // default ["order", "hidden"]; [] turns layout sync off
};

// data-grid-url-state/layout-param.ts (barrel exports, like the sort/filter codecs)
export function serializeLayoutPart(part: UrlLayoutPart, layout: ColumnLayout): string;
export function parseLayoutPart(part: UrlLayoutPart, raw: string): Partial<ColumnLayout>;
export const MAX_URL_LAYOUT_COLUMNS = 1024;
export const MAX_URL_LAYOUT_PARAM_LENGTH = 16_384;
```

URL keys (with `prefixedKey`, `prefixed-key.ts:2-4`):

| Part | Key | Format | "None" value |
|---|---|---|---|
| `order` | `cols` | `id,id,id` (each `encodeURIComponent`) | — |
| `hidden` | `hide` | `id,id` | `-` (defs hide some, the user shows all) |
| `widths` | `widths` | `id:240,id:80` (integer px) | absent = no resized column |
| `pins` | `pins` | `id:l,id:r` | `-` (defs pin some, the user unpinned all) |

A given `pins` part replaces all pins (the W5-11 omitted-part rule), so a column absent from it is
unpinned. This makes an unpinned def-pinned column round-trip, which `applyDefaultColumnLayout`
cannot do today (`store/compute.ts:497-498` keeps the def pin).

## Behavior

- **Mount.** Read once, with the existing `appliedRef` guard
  (`use-data-grid-url-state.ts:144-150`): parse every opted-in part, then one
  `setColumnLayout(parts)` call (one commit, one `onColumnLayoutChange`). An absent param on mount
  leaves the store alone (the seed or `defaultColumnLayout` wins), as for sort and filter.
- **`applyFromUrl` (popstate recipe).** An absent param resets that part to the def default.
- **Write-back.** On a `state.columnLayout` change, for each opted-in part: compare with the last
  written part, serialize, then write `value || null` with `history: "replace"` (the existing
  keys' options, `use-data-grid-url-state.ts:69-92`). A part equal to the def default removes
  its param.
- **Controlled layout.** When the consumer controls a part through `columnLayout` and the URL owns
  it too, the controlled value wins (gesture-first, W5-11 decision 5) and dev mode warns once.
- **Sort / filter / selection / editing / readOnly.** Layout changes rebuild visible columns; the
  W5-11 selection remap applies. readOnly does not block layout gestures today and does not block
  the URL either. The open editor follows the W4-01 rules for a hidden column (cancel).
- **Plugins.** None; the hook stays a hook (plugin spec decision 8: url-state owns props).

## Security

- A param longer than `MAX_URL_LAYOUT_PARAM_LENGTH` is ignored as a whole, with one dev warning.
- At most `MAX_URL_LAYOUT_COLUMNS` raw segments are read (`split` with a limit), so a forged link
  cannot allocate past it. The sort codec gets the same raw-segment cap (`sort-param.ts:41`
  splits the whole string today).
- Ids decode through `safeDecode`; undecodable, empty, or duplicate ids are dropped (first wins);
  unknown ids are dropped by the normalizer with one dev warning (the sort/filter rule,
  `use-data-grid-url-state.ts:116-120`).
- Widths accept `^\d{1,5}$` only, then `clampColumnWidth` (`columns/resolve-column-width.ts:18-21`).
  Pins accept `l` and `r` only. Parsing never throws.
- Ids are written with `encodeURIComponent`, so a column id cannot inject another param.

## Performance

URL parse and serialize are O(columns), once per mount, navigation, or commit. Nothing runs per
row or per drag frame.

## Accessibility

No new UI. The restored layout is the same DOM as a gesture-made layout.

## Files

- Add: `data-grid-url-state/layout-param.ts`, `layout-param.test.ts`.
- Change: `use-data-grid-url-state.ts` (option, four keys, mount apply, write-back),
  `data-grid-url-state.tsx` (barrel), `sort-param.ts` (raw-segment cap).
- `registry.json`: new file in `data-grid-url-state`; add the missing
  `DammersCode/gridcn/data-grid-pagination` registry dependency (`use-data-grid-url-pagination.ts:5`
  imports it, `registry.json:951-953` omits it).

## Docs, registry, CHANGELOG

- `addons/url-state.mdx`: a "Column layout" section with the `layout` option and the key table;
  the bounds bullet gains the layout caps; delete the "not synced" callout; a warn callout for a
  part that is both URL-owned and controlled. `columns.mdx` "Persisting a user's layout" links it.
- CHANGELOG `### Added`: `layout` option; `### Fixed`: sort raw-segment cap, url-state registry
  dependency.

## Test plan

- Unit `layout-param.test.ts`: round trip of every part; `-` none values; oversize param ignored;
  1,025 segments read as 1,024; malformed percent-encoding, duplicate ids, bad widths (`-5`,
  `1e9`, `abc`), bad pins (`x`) dropped; never throws.
- Unit hook: default writes `cols`/`hide` only; a reorder writes `cols` once at drop; a resize with
  `widths` opted in writes once at release, never per frame; a layout equal to the defs removes the
  params; mount applies one `setColumnLayout` (one event); unknown ids warn once; an unpinned
  def-pinned column round-trips; `layout: []` writes nothing.
- Browser: a shared link with `cols` and `hide` restores order and visibility on first paint
  after mount; back/forward with the popstate recipe restores the previous layout.

## Dependencies

W5-11 (`setColumnLayout`, `state.columnLayout`, normalizer; snapshot identity only at commit
points), W2-16 (URL bounds pattern, done).

## Open product questions

1. Should `widths` be in the default set? Recommendation: no — widths depend on the viewer's
   screen; teams that want pixel-exact links opt in.
