import { useEffect, useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridStoreApi, type DataGridStoreState } from "../data-grid";

/** Publishes the grid's own store api so a test can drive actions (e.g. `updateCells`) and read derived state. */
export function StoreProbe({ onReady }: { onReady: (api: StoreApi<DataGridStoreState>) => void }) {
  const api = useDataGridStoreApi();
  const readyRef = useRef(false);
  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    onReady(api);
  }, [api, onReady]);
  return null;
}
