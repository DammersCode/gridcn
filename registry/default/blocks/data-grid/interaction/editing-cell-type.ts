import { createContext } from "react";
import type { CellType } from "../types";

/** The cell type of the cell being edited; `useCellEditor` reads its `fromText` when the codec has no `toValue`. */
export const EditingCellTypeContext = createContext<CellType<any, any, any> | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
