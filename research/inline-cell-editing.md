# Inline cell editing: edit in place, no visible switch

Status: implemented in 1.2.0 (steps 1 to 5, 7 and 8). Step 6 (`contentEditable`) is dropped: the measurement test passes with plain inputs. The review pass is done.

## Goal

Starting an edit must not change how the cell looks. The text keeps its exact position and size, no input background or border appears, and nothing jumps. Long text opens as a surface over the cell, anchored at the cell's top-left. The date editor keeps the displayed text where it is while the calendar opens.

## How the reference grid does it

Findings from reading its cell variants and cell wrapper. Nothing here is measured yet.

- **Short text:** one `contentEditable` element is both the display and the editor. Edit mode flips `contentEditable` on the same node, so the text node never moves. No `<input>` exists, so no input background, border, padding or font metrics can differ. Enter and Tab commit and move, Escape restores the draft, blur commits. A typed first character is stored on keydown and inserted after focus, so the keystroke is not lost.
- **Long text:** the cell stays a one-line display. The editor is a popover whose top edge lines up with the cell's top edge (`sideOffset` = minus the cell height, `align="start"`). Its textarea has no border or shadow, a minimum height, a maximum height and scrolls inside. The first typed character is inserted after focus, and the caret goes to the end. Changes save on a debounce, Ctrl/Cmd+Enter saves, Escape restores.
- **Date:** the display text stays in the cell. The popover opens below it with `alignOffset` equal to the cell padding, so the calendar lines up with the text, not the cell edge. Picking a date commits and closes.
- **Cell wrapper:** the focus ring is an inset ring on the cell, the selection tint is a fill. Edit mode adds no extra border or background.

## What gridcn does today

- **Short text, number and others:** a real `<Input>` replaces the display span. It has its own box model, so any difference in line height, padding or font size moves the text. Hypothesis to verify: in dark mode the `dark:bg-input/30` class of the input outranks `bg-transparent`, which shows a background.
- **Long text and date:** the trigger is `<span class="block size-full truncate">`, not the display component used out of edit mode. The cell is `flex items-center`. A block span with `size-full` fills the cell height and puts its line box at the top, while the display span is centered. Hypothesis to verify: this is why the date text jumps up when the editor opens.
- **Edit mode skips the display wrapper** in `cell.tsx`: `isEditing ? content : <span ...>{content}</span>`. The text alignment classes (`text-end`) therefore live in each editor separately and can drift.

## Plan

1. **Measure first.** Add a browser test helper that returns the text's bounding rect (a `Range` over the text node) before and after the edit starts. Assert the same x, y, width and height within 0.5 px for text, number, date, long text and url, in light and dark mode, at default and compact row heights. This test is red today for the date editor (suspected) and gives every later step an acceptance check.
2. **Render the editor trigger through the display component.** Date and long text use the same component and classes as the cell display, so the trigger box equals the display box. Remove the separate `block size-full` span.
3. **Make the text input invisible.** Give editors one shared class set (no border, no background in any color scheme, no ring, same font size, line height and zero padding as the cell). Check `dark:` variants, `focus-visible` border and autofill background. Keep the cell's own focus ring as the only edit indicator.
4. **Long text popover geometry.** Anchor the popover top-left to the cell's top-left, the same as the reference. Use a minimum and maximum height with inner scroll, no border, no shadow. Compare the edge cases: a cell near the bottom or right edge of the viewport (the popover flips or shifts, the text must not move first) and a pinned column.
5. **Date popover alignment.** Offset the popover by the cell padding so the calendar starts under the text. The typed-date input inside the popover keeps working. Check that the text does not move when the popover opens.
6. **Decide on `contentEditable` for single-line text.** It gives the strongest guarantee (the same node), but it brings paste sanitizing, IME handling, `Enter` newline handling and `textContent` pitfalls. Prototype it behind the text editor only if steps 2 and 3 leave a measurable shift. Keep `<input>` otherwise. The prototype must pass the existing IME and hostile-value tests.
7. **First keystroke.** Confirm that a typed character that starts an edit lands once, with the caret after it, in every editor (the existing `initialText` path). Add a test for long text and date if missing.
8. **Scroll and focus.** Editors focus with `preventScroll`, and the edit start scrolls the cell into view (done in 1.1.0). Re-verify that no editor causes a jump of the grid scroll position.

## Acceptance

- Text rect before and after edit start is identical (step 1 test) for every built-in cell type.
- No computed background or border color on the editor element other than transparent, in light and dark.
- The date and long-text popovers open without any visible shift of the cell content, checked in Chromium and Firefox with screenshots before and after.
- Existing gates stay green: types, lint, unit, browser, compiler, e2e install.
- A changelog entry for the visual change. Docs for the cell editors get `status: updated`.

## Open questions for the review

- Is `contentEditable` worth its sharp edges, or does the invisible `<input>` reach the same result?
- Should a custom editor get the same invisible-input class set through a shared export, or stay free-form?
- Does the long-text popover keep a visible edge (a shadow or border) so the user sees it is a separate surface, or does it blend into the grid?
- Does a visual change like this count as breaking for consumers that style the editor?

## Review brief

Run a review pass with its own research. It reads this file, the reference grid's cell variants and wrapper, and the files below. It checks each hypothesis against the code, runs the measurement from step 1, and marks every step keep, change or drop.

- `registry/default/blocks/data-grid/cell.tsx` (edit branch and display wrapper)
- `registry/default/blocks/data-grid/cell-types/{text,long-text,date,number,url}.tsx`
- `registry/default/blocks/data-grid/interaction/{use-cell-editor,use-seed-focus,use-commit-guard}.ts`
