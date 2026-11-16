/** Compile-only check: the `*At` row actions accept plain view row numbers and branded view indexes. */
import type { DataGridActions } from "./types";
import { viewIndexes } from "../types";

declare const actions: DataGridActions;
declare const viewRowIndex: number;

actions.deleteRowsAt([viewRowIndex]);
actions.duplicateRowsAt([viewRowIndex]);
actions.deleteRowsAt(viewIndexes([1, 2]));
actions.duplicateRowsAt(viewIndexes([1, 2]));
actions.setRowCheckedAt(viewRowIndex, true);
