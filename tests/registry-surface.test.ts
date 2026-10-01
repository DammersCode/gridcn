import { expect, it } from "vitest";
import * as dataGrid from "@/registry/default/blocks/data-grid/data-grid";
import * as dataGridSdk from "@/registry/default/blocks/data-grid/data-grid-sdk";
import * as dataGridKeybindings from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";

// Docs teach only `formatShortcut`/`isMacPlatform`; the token formatter and instance id are add-on seams on the sdk surface.
it("keeps the add-on seams off the `data-grid` consumer barrel", () => {
  expect(dataGrid).toHaveProperty("isMacPlatform");
  expect(dataGrid).toHaveProperty("formatShortcut");
  expect(dataGrid).not.toHaveProperty("formatShortcutToken");
  expect(dataGrid).not.toHaveProperty("useDataGridInstanceId");
});

it("carries the moved seams on the `data-grid-sdk` surface", () => {
  expect(dataGridSdk).toHaveProperty("formatShortcutToken");
  expect(dataGridSdk).toHaveProperty("useDataGridInstanceId");
});

// The core `formatShortcut` returns the same tokens; the keybindings entry point stops re-exporting the name.
it("keeps `bindingTokens` off the `data-grid-keybindings` entry point", () => {
  expect(dataGridKeybindings).toHaveProperty("BindingChips");
  expect(dataGridKeybindings).not.toHaveProperty("bindingTokens");
});
