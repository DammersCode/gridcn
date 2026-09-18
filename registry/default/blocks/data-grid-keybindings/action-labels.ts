import type { DataGridLabels, GridAction } from "@/registry/default/blocks/data-grid/data-grid";

/** Splits "camelCaseAction" into "Camel case action" for actions missing from {@link DataGridLabels.keybindings.actions}. */
function humanizeActionName(action: string): string {
  const spaced = action.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Human label for `action` from {@link DataGridLabels.keybindings.actions}, falling back to a humanized form of its name for consumer-added actions. */
export function labelForAction(action: GridAction, labels: DataGridLabels): string {
  return labels.keybindings.actions[action] ?? humanizeActionName(action);
}
