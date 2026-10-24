import { useRef } from "react";
import type { StoreApi } from "zustand/vanilla";
import { useDataGridStoreApi } from "../store";

export type StoreProbeReading = {
  liveListeners(): number;
  listenerCallsDuring(fn: () => void): number;
  subscribeCalls(): number;
  restore(): void;
};

export function instrumentStore<S>(store: StoreApi<S>): StoreProbeReading {
  const originalSubscribe = store.subscribe;
  let live = 0;
  let subscribes = 0;
  let listenerCalls = 0;

  store.subscribe = (listener) => {
    subscribes += 1;
    live += 1;
    const unsubscribe = originalSubscribe((state, prev) => {
      listenerCalls += 1;
      listener(state, prev);
    });
    let released = false;
    return () => {
      if (!released) live -= 1;
      released = true;
      unsubscribe();
    };
  };

  return {
    liveListeners: () => live,
    subscribeCalls: () => subscribes,
    listenerCallsDuring(fn) {
      const before = listenerCalls;
      fn();
      return listenerCalls - before;
    },
    restore() {
      store.subscribe = originalSubscribe;
    },
  };
}

/** Render before every sibling that subscribes, so the wrap lands ahead of their effects. */
export function InstrumentedStoreProbe({ onReady }: { onReady: (probe: StoreProbeReading) => void }) {
  const storeApi = useDataGridStoreApi();
  const probeRef = useRef<StoreProbeReading | null>(null);
  if (probeRef.current === null) {
    probeRef.current = instrumentStore(storeApi);
    onReady(probeRef.current);
  }
  return null;
}
