import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useDataGridComments } from "@/registry/default/blocks/data-grid-comments/use-data-grid-comments";
import { useDataGridFill } from "@/registry/default/blocks/data-grid-fill/use-data-grid-fill";
import { useDataGridFindReplace } from "@/registry/default/blocks/data-grid-find-replace/use-data-grid-find-replace";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/use-data-grid-history";
import { useDataGridKeybindings } from "@/registry/default/blocks/data-grid-keybindings/use-data-grid-keybindings";
import { ADDON_COMMAND_KEYS } from "./sync-props";

it("names the commands and a key that the add-ons bind", () => {
  const { result } = renderHook(() => [useDataGridComments(), useDataGridFill(), useDataGridFindReplace(), useDataGridHistory(), useDataGridKeybindings()].map(({ plugin }) => plugin.keymap ?? {}));
  const bound = Object.assign({}, ...result.current) as Record<string, readonly string[]>;
  expect(Object.keys(ADDON_COMMAND_KEYS).sort()).toEqual(Object.keys(bound).sort());
  for (const [name, key] of Object.entries(ADDON_COMMAND_KEYS)) expect(bound[name]).toContain(key);
});
