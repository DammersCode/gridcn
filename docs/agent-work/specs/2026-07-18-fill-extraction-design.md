# Fill-handle extraction → `data-grid-fill` add-on (workplan #48, cut #2 — user-approved 2026-07-18)

User decision: the base grid must not carry too much logic by default — fill moves out despite
the README positioning, which gets rewritten (still free/MIT, now "one-line add-on install").
Clipboard stays core (not named by the user; research recommended against). Research basis:
the 2026-07-18 lean-core coupling evaluation (~680 LOC leave core).

## Seams (in build order)

1. **Overlay-plugin slot** — SHARED with the presence extraction (specs/2026-07-18-presence-
   extraction-design.md builds it first; this lane reuses it). FillPreviewOverlay + FillHandle
   move out of overlays.tsx into the add-on and register as plugins.
2. **Interaction seam (mostly exists):** use-grid-interaction already takes fillDown/fillRight/
   cancelDrag as OPTIONAL callbacks. New: root.tsx stops calling useFillHandle unconditionally;
   instead the add-on registers its handlers. Consumer API: a `<DataGridFillHandle />` child of
   DataGridRoot (or a registration hook — builder picks the cleaner, following how overlay
   plugins register) that wires pointer handlers + keymap callbacks via the root context. With
   the add-on absent, everything no-ops exactly like today's optional-callback paths.
3. **GridAction/keymap:** `fillDown`/`fillRight` STAY in the GridAction union and DEFAULT_KEYMAP
   (two string literals are cheaper core surface than an extensible-action mechanism — decided);
   without the add-on they dispatch to absent callbacks and no-op. keybindings add-on keeps its
   clipboardFill category (documents both; harmless if fill absent).
4. **Store:** `fillPreview`/`setFillPreview` move to add-on-local state IF cleanly separable;
   if the overlay-plugin ctx needs store plumbing that adds more seam than the ~15 lines save,
   they may stay in core as documented dormant state — builder measures, reports the choice.
   `onFillPattern` prop moves to the add-on's surface.

## Moves

- `fill/` (7 files, 586 LOC) → new registry item `data-grid-fill` (registryDependencies:
  data-grid), plus the overlay components. `useDataGridFillPreview` export moves.
- registry.json: new item; core item's files list shrinks.
- Series-inference (`detect-series.ts`) goes with it — it is fill-only.

## Positioning rewrite (explicit user approval)

- README headline: from "all three in the core item, free" to core = range selection + Excel
  clipboard + editing engine; fill handle = its own free MIT add-on, one-line install. Feature
  table gains the data-grid-fill row. CHANGELOG entry under Changed (breaking, pre-1.0).
- Docs: fill-handle.mdx becomes the add-on page (install command per the #47 rule); quick-start
  untouched (already minimal); index/hero copy that mentions the trio updated the same way.
- The "gap gridcn fills" claim stays true (all features remain free vs AG/MUI paid tiers) —
  wording shifts from "in the core item" to "core + free add-ons".

## Contracts

Fill browser tests move to the add-on and stay green (drag-fill, series, mod+d/mod+r, fill vs
selection overlays alignment in pin zones); zero-render probes green; without the add-on: no
handle rendered, mod+d/mod+r no-op, no console errors. Payload rebuild.

## Sequencing

After #45 (defaultData), #53 (standard schema), and the PRESENCE extraction (which builds the
shared overlay seam). Fill is the queue's last core-surgery item before #49/#50.
