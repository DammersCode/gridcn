import { useDataGridHistory } from "./use-data-grid-history";

export function noArgHistory() {
  return useDataGridHistory<{ id: string }>();
}

export function recordWithoutSource() {
  const history = useDataGridHistory<{ id: string }>();
  history.record({ ops: [{ type: "delete", rowId: "1", row: { id: "1" }, index: 0 }] });
}
