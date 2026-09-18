import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP, DEFAULT_LABELS, type GridAction } from "@/registry/default/blocks/data-grid/data-grid";
import { categoryForAction, KEYBINDING_CATEGORIES } from "./action-groups";
import { labelForAction } from "./action-labels";

describe("categoryForAction", () => {
  it("assigns every action bound in DEFAULT_KEYMAP to a real category (never silently 'other')", () => {
    const boundActions = Object.keys(DEFAULT_KEYMAP) as GridAction[];
    expect(boundActions.length).toBeGreaterThan(0);
    for (const action of boundActions) {
      expect(categoryForAction(action), `action "${action}" should have a mapped category`).not.toBe("other");
    }
  });

  it("falls back to 'other' for an action absent from the map (consumer-added actions)", () => {
    expect(categoryForAction("someConsumerAction" as GridAction)).toBe("other");
  });

  it("only ever returns a category from KEYBINDING_CATEGORIES", () => {
    for (const action of Object.keys(DEFAULT_KEYMAP) as GridAction[]) {
      expect(KEYBINDING_CATEGORIES).toContain(categoryForAction(action));
    }
  });
});

describe("labelForAction", () => {
  it("has a human label for every action bound in DEFAULT_KEYMAP", () => {
    for (const action of Object.keys(DEFAULT_KEYMAP) as GridAction[]) {
      const label = labelForAction(action, DEFAULT_LABELS);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("humanizes an unmapped action name as a fallback", () => {
    expect(labelForAction("someConsumerAction" as GridAction, DEFAULT_LABELS)).toBe("Some consumer action");
  });

  it("uses an overridden label from DataGridLabels.keybindings.actions", () => {
    const labels = { ...DEFAULT_LABELS, keybindings: { ...DEFAULT_LABELS.keybindings, actions: { ...DEFAULT_LABELS.keybindings.actions, undo: "Rückgängig" } } };
    expect(labelForAction("undo", labels)).toBe("Rückgängig");
  });
});
