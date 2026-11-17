import { BUILTIN_ACTIONS } from "./default-keymap";

/** Warns in development, once per name, for a keymap action that is neither a built-in action nor a command. */
export function warnUnknownKeymapActions(
  keymap: Readonly<Record<string, unknown>>,
  commands: Readonly<Record<string, unknown>> | null | undefined,
  warnOnce: (key: string, message: string) => void,
): void {
  for (const action of Object.keys(keymap)) {
    if ((BUILTIN_ACTIONS as readonly string[]).includes(action) || (commands && action in commands)) continue;
    warnOnce(`keymap-unknown:${action}`, `keymap action "${action}" is neither a built-in action nor a command, so its keys do nothing; check the spelling or add it to commands`);
  }
}
