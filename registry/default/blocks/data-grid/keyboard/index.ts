/** Domain barrel — keymap matching, defaults, printable-key detection, binding-string validation. */
export { BUILTIN_ACTIONS, DEFAULT_KEYMAP, keymapContentEqual, PLUGGABLE_ACTIONS } from "./default-keymap";
export { matchKeymap, parseBinding, type KeymapEvent, type ParsedBinding } from "./match-keymap";
export { isPrintableKey } from "./is-printable-key";
export { isMacPlatform } from "./platform";
export { formatShortcut, formatShortcutToken } from "./shortcut-label";
export {
  sharedKeymapBindings,
  validateKeyBinding,
  validateKeymap,
  validateSharedBindings,
  type KeyBinding,
  type SharedKeymapBinding,
} from "./key-syntax";
