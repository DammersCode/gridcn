# Spec: touch and coarse-pointer input (W6-11, FEAT-8)

## Goal

On phones and tablets the grid scrolls natively, selects with a tap, edits with a double-tap,
selects ranges with drag handles, and opens the context menu with a long-press. Every target a
finger must hit is at least 24 × 24 CSS px under a coarse pointer. Mouse and keyboard behavior does
not change.

## Current state (verified)

- Every press selects on `pointerdown`, for every pointer type: `onCellPointerDown` calls
  `selectCellAt` and starts a range drag with pointer capture (`interaction/use-grid-interaction.ts:911-950`);
  marker and header presses do the same (`:990`, `:1008`). On touch the browser then pans and sends
  `pointercancel`, so the drag ends, but the pan has already moved the active cell to wherever the
  finger landed.
- No code reads `event.pointerType` and no `(pointer: coarse)` rule exists in the registry.
- Edit starts on `dblclick` (`onCellDoubleClick`, `:971`). Touch browsers do not fire `dblclick`
  reliably, and double-tap zooms the page unless `touch-action: manipulation` is set (it is not).
- Small targets: fill handle `size-2` = 8 px (`data-grid-fill/fill-overlay.tsx:52`), resize handle
  `w-2` = 8 px (`header-cell.tsx:165`), header menu chevron hidden until hover
  (`opacity-0 … group-hover:opacity-100`, `header-cell.tsx:152`).
- Already touch-safe: the resize handle and the row grip set `touch-none`
  (`header-cell.tsx:165-166`, `rows/marker-cell.tsx:130`); the root sets `select-none`
  (`root.tsx:504`).
- The context menu opens from the trigger's `contextmenu` event (`data-grid-context-menu/context-menu.tsx:89-108`).
  Mobile Safari fires no `contextmenu` on long-press.
- PLAN §11a lists touch selection and fill drag as a v2 limitation.

## Decisions

1. **Gestures key on `event.pointerType`; hit areas key on `(pointer: coarse)`.** A hybrid laptop
   gets touch gestures from its screen and mouse gestures from its trackpad. CSS uses the Tailwind
   `pointer-coarse:` variant (Tailwind 4.3). Rejected: one global "touch mode" from the media query
   — wrong for every hybrid device.
2. **Touch selects on tap, not on press.** For `pointerType === "touch"`, `pointerdown` only records
   the start point; `pointerup` within 10 px and before a pan resolves the tap through the existing
   `selectCellAt` path. A pan (native
   scroll, `pointercancel`) selects nothing. Rejected: keep select-on-press — every scroll start
   moves the cursor.
3. **Double-tap edits; tap never edits.** Two taps on the same cell within 300 ms and 10 px run the
   `dblclick` path (`startEditingAt`, or `activate` for checkbox-like types). The root gets
   `touch-action: manipulation`, so the browser does not zoom on double-tap and pinch-zoom stays
   available. Rejected: tap on the active cell edits — the grid's activation rule is that a single
   press never edits.
4. **Range selection uses two drag handles.** After a touch selection, the primary range shows
   handles at its top-start and bottom-end corners (`touch-action: none`, 24 px hit circle). Dragging
   one handle keeps the opposite corner as the anchor (`selectCellAt(opposite)` then `extendToAt`
   per frame through the existing drag frame loop and auto-scroll). Rejected: long-press then drag —
   it needs a non-passive `touchmove` listener on the scroll root, which makes every touch scroll wait
   for the main thread.
5. **Long-press is the context gesture.** 500 ms without moving more than 10 px: the cell is selected
   (if outside the selection), handles show, and the grid dispatches one synthetic `contextmenu`
   `MouseEvent` at the touch point on the cell. The native touch `contextmenu` (Android) is
   suppressed so the menu opens once. `onCellContextMenu` fires as for a right-click. Rejected: rely
   on native `contextmenu` — Mobile Safari never fires it.
6. **Fill on touch goes through commands.** Under a coarse pointer the fill handle hides (it would
   sit under the bottom-end selection handle), and the context menu shows Fill down and Fill right
   when the fill plugin is mounted (its `fillDown`/`fillRight` commands). Rejected: a second handle at
   the same corner — two overlapping 24 px targets are not reliably hittable.
7. **Reorder needs a grip.** Row reorder already uses the `touch-none` grip. Column reorder gets a
   grip in the header cell, shown only under a coarse pointer when reorder is enabled; the rest of
   the header still pans. Rejected: `touch-action: none` on the whole header — the header row would
   stop scrolling the grid horizontally.
8. **Row height does not change automatically.** Docs recommend `density="comfortable"` (44 px) for
   touch. Rejected: switch density from the media query — the server render does not know the
   pointer, so the first paint would shift.

## API

No new props. Added internals and constants:

```ts
// interaction/touch-gestures.ts (internal)
export const TAP_SLOP_PX = 10;
export const DOUBLE_TAP_MS = 300;
export const LONG_PRESS_MS = 500;

// store state (internal, via the sdk): which pointer made the current selection
selectionPointer: "touch" | "mouse" | "pen" | "keyboard";

// labels: labels.contextMenu.fillDown / fillRight (exist for the shortcut list; reused as menu text)
```

`selectionPointer` decides whether `DataGridOverlays` renders the handles. It is set by the gesture
that wrote the selection and reset to `"keyboard"` by any keyboard selection change.

## Behavior

- **Tap on a header** resolves as today's click (select or sort). **Tap on a marker** selects the row
  on `pointerup`. A marker drag on touch uses the handles instead of the row-drag loop.
- **Checkbox-like cells.** A tap on the checkbox box toggles (existing `pointerHitsCheckboxBox`); the
  box gets 4 px padding under a coarse pointer, so its hit rect is 24 px.
- **Editing.** The editor opens with the virtual keyboard. After the `visualViewport` resizes, the
  grid scrolls the cell into its own viewport (existing `scrollCellIntoView`) and scrolls the page by
  the overlap between the cell rect and `visualViewport` (no `scrollIntoView` on grid elements, which
  live in transformed layers).
- **Assistive technology.** When a screen reader's activation reaches a cell as a `click` without a
  preceding `pointerdown` on that cell, the click handler selects the cell. Today such a click
  selects nothing (selection happens on `pointerdown`).
- **Selection and CellRef.** Unchanged shapes; handles write through the existing actions, so W5-11
  emits `onSelectionChange` per real change as for a mouse drag.
- **Sort, filter, clipboard, readOnly.** Unchanged. Paste on touch uses the context menu item (the
  `clipboard-read` permission path). In a read-only grid, double-tap does not edit (store guard) and
  Fill items are hidden.
- **Plugins.** A plugin `Overlay` receives `selectionPointer` in its ctx; fill reads it to hide its
  handle. Plugins add no touch listeners of their own.
- **Pointer capture.** Handles and grips call `setPointerCapture`; every gesture tears down on
  `pointerup`, `pointercancel`, and `lostpointercapture` (R-10 rule).

## Security

No new input surface. Timers are per gesture and cleared on unmount; a stale long-press timer can
never fire after the grid unmounts.

## Performance

- No new listener per cell: touch logic lives in the existing delegated handlers in
  `use-grid-interaction.ts`; one timer per active gesture.
- No non-passive `touchmove` or `wheel` listener anywhere; native scroll stays on the compositor.
- Handles are two elements inside `DataGridOverlays`, rendered only when `selectionPointer ===
  "touch"`; they reuse the overlay's window clamp.
- Budget: the `perf.browser` scroll FPS ratio and the `scroll-drag` wasted-render probes stay within
  their bars with touch gestures dispatched.

## Accessibility

- Coarse-pointer targets ≥ 24 × 24 px (WCAG 2.2 SC 2.5.8): selection handles, resize handle hit area
  (`after:` pseudo-element widened under `pointer-coarse:`), column grip, checkbox box, header menu
  chevron (always visible under `pointer-coarse:`).
- Pinch-zoom is never disabled (`touch-action: manipulation` keeps it).
- Handles are `aria-hidden`; the same range is reachable with `shift+Arrow` on a hardware keyboard.
- Every touch gesture has a non-gesture alternative: context menu items for fill, row ops, and
  copy/paste (WCAG 2.5.1).

## Files to add or change

- Add `data-grid/interaction/touch-gestures.ts` (tap, double-tap, long-press state machine as pure
  functions over pointer samples, unit-testable).
- `data-grid/interaction/use-grid-interaction.ts`: branch on `pointerType` in `onCellPointerDown`,
  `onMarkerPointerDown`, `onMarkerCheckboxPointerDown`, `onHeaderPointerDown`; click selection for AT.
- `data-grid/root.tsx`: `touch-action: manipulation` on the scroll root; touch `contextmenu`
  suppression.
- `data-grid/overlays.tsx`: selection handles; `OverlayPluginCtx.selectionPointer`.
- `data-grid/header-cell.tsx`: coarse hit areas, always-visible chevron, column grip;
  `columns/use-column-reorder.ts`: arm from the grip on touch.
- `data-grid/cell-types/checkbox.tsx`: coarse padding on the box.
- `data-grid-fill/fill-overlay.tsx`: hide under `selectionPointer === "touch"` and `pointer-coarse:`;
  `touch-none` on the handle for pen input.
- `data-grid-context-menu/menu-items.tsx`: Fill down / Fill right items when the fill commands exist.
- `PLAN.md` §11a: drop the "touch is v2" limitation line.

## Docs, registry, CHANGELOG

- New section "Touch" in `selection-keyboard.mdx` (gesture table) and `accessibility.mdx` (target
  sizes); `addons/fill.mdx` and `addons/context-menu.mdx`: touch notes.
- CHANGELOG `### Added`; **Breaking:** a touch press no longer selects on `pointerdown` (consumers who
  read the selection inside their own `pointerdown` handler see it one event later).
- Payloads: `data-grid`, `data-grid-fill`, `data-grid-context-menu`; `test:e2e-install`.

## Test plan

- Unit `touch-gestures.test.ts`: tap vs pan by slop; double-tap timing and distance; long-press
  timer cancel on move, on `pointercancel`, and on unmount.
- Unit (jsdom, synthetic `PointerEvent` with `pointerType: "touch"`): pan selects nothing; tap
  selects; double-tap edits; read-only double-tap does not edit; long-press dispatches exactly one
  `contextmenu` and fires `onCellContextMenu`; keyboard selection hides handles; AT click selects.
- Browser (Playwright context with `hasTouch: true`, `page.touchscreen.tap` smoke plus synthetic
  pointer sequences): handle drag extends the range with auto-scroll; opposite-corner anchor;
  column grip reorders; resize handle hit rect ≥ 24 px under `pointer-coarse` emulation; the context
  menu opens once on long-press; axe clean.
- Regression: all mouse suites green unchanged (`scroll-drag`, `row-reorder`, `column-ux`, fill).

## Dependencies

- W2-09 and R-10 (drag teardown on `pointercancel`/`lostpointercapture`), R-78 (touch row reorder
  past the window), W5-11 (selection emit rules), W5-13 (fill as a plugin with commands; overlay ctx).

## Open product questions

1. Should long-press-and-drag also extend a range? Recommendation: no; it needs a non-passive
   `touchmove` listener that slows every touch scroll, and the handles cover the need.
2. Hide the fill handle on coarse pointers in favor of menu items? Recommendation: yes (decision 6);
   revisit if users ask for touch fill drag, with the handle moved off the selection corner.
