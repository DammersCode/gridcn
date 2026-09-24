# Typed key-binding syntax (spec)

Status: decision record, implemented in this branch (`feat/typed-key-syntax`).

## Problem

`Keymap = Partial<Record<GridAction, string[]>>` takes raw strings. A typo
(`"mod+shfit+ArrowUp"`) compiles, parses to an unknown modifier, and silently
never matches. No autocomplete, no feedback.

## Pattern (from industry practice)

Mature hotkey libraries type key combinations as template-literal unions:

- a finite key vocabulary as literal unions (letters, digits, function keys,
  navigation/editing/named keys, printable punctuation),
- binding strings as `modifier+...+key` template unions, one branch per
  modifier arity, in a canonical modifier order, with contradictory
  combinations (primary modifier + literal Ctrl) excluded,
- a `(string & {})` escape hatch at the binding level so arbitrary strings
  stay assignable (no breaking change for exotic keys; IntelliSense still
  lists the valid combinations),
- a runtime validator for binding strings (empty parts, unknown or duplicated
  modifier tokens, unknown multi-character keys) surfaced as dev-only
  warnings, since the type cannot reject the escape-hatch strings.

Physical (layout-independent) keys via bracketed `KeyboardEvent.code` tokens
and a scored logical-vs-physical event matcher (code fallback for
layout-transformed glyphs, AltGraph/IME guards) belong to the same pattern
family but change matching behavior; out of scope here (upgrade path below).

## Decisions

- **New `keyboard/key-syntax.ts`** (standalone, no imports):
  - `KeyPart`: lowercase letters `a`–`z` (bindings are lowercase; matching is
    case-insensitive), digits `0`–`9`, `F1`–`F24`, navigation keys
    (arrows, `Home`, `End`, `PageUp`, `PageDown`), editing keys
    (`Enter`, `Escape`, `Tab`, `Backspace`, `Delete`), printable punctuation,
    and the literal space `" "` (the keymap's space token; `KeyboardEvent.key`
    for the space bar is `" "`, and `"Space"` never matches it).
  - `KeyBinding`: `KeyPart` | `mod|ctrl|shift|alt+KeyPart` | two-modifier
    prefixes (`mod+shift`, `mod+alt`, `ctrl+shift`, `ctrl+alt`, `shift+alt`;
    `mod+ctrl` excluded — on non-mac `mod` is Ctrl, and the matcher's literal
    `ctrl` path short-circuits `mod` anyway) | three-modifier prefixes
    (`mod+shift+alt`, `ctrl+shift+alt`) | `(string & {})`.
  - `validateKeyBinding(binding): string[]` — issue messages; accepts single
    code points (printable or space, any case) and case-sensitive stable named
    keys (the full W3C key-value set, a superset of the type's autocomplete
    vocabulary; transient IME states like `Dead`/`Process`/`Unidentified` and
    modifier key values stay rejected); flags empty parts, unknown/duplicate
    modifier tokens, unknown multi-char keys.
  - `validateKeymap(keymap)` — dev-only (`isDev()` early return, so production
    neither pays the cost nor fills the warn-once set): `warnDev` once per
    unique `action:binding` (house pattern, same as
    `checkUnresolvableColumnTypes`).
- **`types.ts`**: `Keymap = Partial<Record<GridAction, KeyBinding[]>>`;
  re-exports `KeyBinding`. No breaking change (escape hatch).
- **Wiring**: `validateKeymap` called from the existing `root.tsx` keymap
  effect (next to `_registerKeymap`), the single choke point of the effective
  keymap. No new effect, no store change.
- **Matcher untouched**: `parseBinding`/`matchKeymap` semantics frozen —
  behavior change is risk without request.
- **Barrel**: `KeyBinding` re-exported from the `data-grid` barrel (docs name
  it); `validateKeymap`/`validateKeyBinding` stay on the internal keyboard
  barrel (docs never tell a reader to call them).
- **Tests**: unit tests for the validator (valid/invalid cases, warn-once,
  `DEFAULT_KEYMAP` fully valid) + a `.type-test.ts` (strict unions reject
  typos via `@ts-expect-error`; escape hatch accepts `string`;
  `ModifierPrefix` union shape via `Equal`).

## Explicitly skipped (upgrade paths)

- Physical `[KeyS]`/`[Numpad5]` syntax + `event.code` matching: needs a
  `code` field on `KeymapEvent` and matcher changes; add when a consumer
  needs layout-independent bindings.
- Matcher hardening (scored match, implicit-Shift glyph, AltGraph guard,
  code-fallback for Dvorak/Colemak/AZERTY dead keys): separate spec; the
  current exact-modifier match is pinned by tests.
- Alias/normalize layer (`Ctrl`/`Cmd`/`Option` tokens, key normalization):
  the keymap keeps its lowercase `mod`/`ctrl`/`shift`/`alt` syntax.
