/** Domain barrel — keymap matching, defaults, printable-key detection, binding-string validation. */
export { DEFAULT_KEYMAP } from "./default-keymap";
export { matchKeymap, parseBinding, type KeymapEvent, type ParsedBinding } from "./match-keymap";
export { isPrintableKey } from "./is-printable-key";
export { isMacPlatform } from "./platform";
export { validateKeyBinding, validateKeymap, type KeyBinding } from "./key-syntax";
