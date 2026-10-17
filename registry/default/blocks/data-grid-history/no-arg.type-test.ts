import { useDataGridHistory } from "./use-data-grid-history";

export function noArgHistory() {
  return useDataGridHistory<{ id: string }>();
}
