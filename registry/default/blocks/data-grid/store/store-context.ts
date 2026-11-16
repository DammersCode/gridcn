import { createContext } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { DataGridStoreState } from "./types";

/** The grid store's React context, in a module with no runtime imports of the store, so a cell type can read it without an import cycle. */
export const DataGridStoreContext = createContext<StoreApi<DataGridStoreState> | null>(null);
