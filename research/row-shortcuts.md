# Row insert-above and delete-rows shortcuts

## Decision

Add two `GridAction`s to `DEFAULT_KEYMAP`:

- `insertRowAbove`: `mod+shift+u` ("U" = up). Same guard as `insertRowBelow`, position `"above"`.
- `deleteRows`: `mod+shift+Backspace`. Same selection logic as `duplicateRow`: deletes the
  selected view rows, else the active cell's row. No `createRow`/`duplicateRow` gate — `deleteRows`
  needs neither.

Both skip on `readOnly` and call `preventDefault`. Both group as `"editing"` in the keybindings
dialog and get a `ContextMenuShortcut` next to their existing context-menu items.

## Rationale

Sheets (`Ctrl+Alt+=`/`-`) and Excel (`Ctrl+Shift+=`, `Ctrl+-`) chords are undeliverable on the
web: `Alt`-based combos collide with `AltGr` on European keyboard layouts, and `Ctrl+plus/minus`
or `Ctrl+=` is the browser's own (non-preventable) zoom shortcut. `mod+shift+u` and
`mod+shift+Backspace` are not intercepted by any tested browser.

## Rejected chords

| Chord | Reason |
|---|---|
| `mod+alt+=` / `mod+alt+-` (Sheets-style) | `AltGr` collision on European layouts |
| `mod+shift+=`, `mod+-` (Excel-style) | Browser zoom, not preventable |
| `mod+shift+n` | Chrome incognito window |
| `mod+shift+Delete` | Browser "clear browsing data" dialog |
| `mod+shift+i` / `j` / `c` / `k` | Devtools panels |
| `mod+shift+e` / `m` | Browser-chrome shortcuts (extensions / profile switcher) |

## Precedent

Follows the same reasoning already documented next to `insertRowBelow`/`duplicateRow` in
`default-keymap.ts`: pick unreserved `mod+shift+<letter>` chords over OS/browser-claimed ones.
