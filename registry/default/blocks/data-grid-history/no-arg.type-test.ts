import { serverSpecKey, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "./use-data-grid-state";
import { useDataGridHistory } from "./use-data-grid-history";

export function noArgHistory() {
  return useDataGridHistory<{ id: string }>();
}

export function recordWithoutSource() {
  const history = useDataGridHistory<{ id: string }>();
  history.record({ ops: [{ type: "delete", rowId: "1", row: { id: "1" }, index: 0 }] });
}

export function specDatasetKey() {
  return useDataGridHistory<{ id: string }>({ datasetKey: serverSpecKey });
}

export function statePlugins(plugin: DataGridPlugin<{ id: string }>) {
  return useDataGridState<{ id: string }>([], { plugins: [plugin] }).plugins;
}
