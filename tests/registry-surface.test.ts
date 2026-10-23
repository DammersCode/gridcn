import { expect, it } from "vitest";
import * as dataGrid from "@/registry/default/blocks/data-grid/data-grid";
import * as dataGridSdk from "@/registry/default/blocks/data-grid/data-grid-sdk";
import * as dataGridKeybindings from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";

// Docs teach only `formatShortcut`/`isMacPlatform`; the instance id is an add-on seam on the sdk surface.
it("keeps the add-on seams off the `data-grid` consumer barrel", () => {
  expect(dataGrid).toHaveProperty("isMacPlatform");
  expect(dataGrid).toHaveProperty("formatShortcut");
  expect(dataGrid).not.toHaveProperty("formatShortcutToken");
  expect(dataGrid).not.toHaveProperty("useDataGridInstanceId");
});

it("carries the instance id on the `data-grid-sdk` surface and no unused token formatter", () => {
  expect(dataGridSdk).toHaveProperty("useDataGridInstanceId");
  expect(dataGridSdk).not.toHaveProperty("formatShortcutToken");
  expect(dataGridSdk).not.toHaveProperty("useDataGridStore");
});

// Add-on-only runtime names live on the sdk surface; the docs teach none of them to consumers.
it("moves the add-on-only store, attribute, history, and operator names to `data-grid-sdk`", () => {
  const moved = [
    "useDataGridStoreApi",
    "useDataGridCommands",
    "GRID_ATTR",
    "gridAttrSelector",
    "createHistory",
    "setCellValue",
    "useDataGridColumnFeatureFlags",
    "useDataGridSearchMatches",
    "useDataGridSearchCapped",
    "useDataGridIsColumnFiltered",
    "TEXT_FILTER_OPERATORS",
    "COMPARISON_FILTER_OPERATORS",
    "SET_FILTER_OPERATORS",
    "rowAccessorFor",
    "makeFilterPredicate",
    "toSafeText",
  ];
  for (const name of moved) {
    expect(dataGrid, name).not.toHaveProperty(name);
    expect(dataGridSdk, name).toHaveProperty(name);
  }
  expect(dataGrid).toHaveProperty("useDataGridStoreProps");
});

// The core `formatShortcut` returns the same tokens; the keybindings entry point stops re-exporting the name.
it("keeps `bindingTokens` off the `data-grid-keybindings` entry point", () => {
  expect(dataGridKeybindings).toHaveProperty("BindingChips");
  expect(dataGridKeybindings).not.toHaveProperty("bindingTokens");
});
