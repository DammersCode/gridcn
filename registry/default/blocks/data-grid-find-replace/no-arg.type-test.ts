import { useDataGridFindReplace } from "./use-data-grid-find-replace";

export function noArgFindReplace() {
  return useDataGridFindReplace();
}

export function resultScopeFindReplace() {
  return useDataGridFindReplace({ findScope: "result" });
}
