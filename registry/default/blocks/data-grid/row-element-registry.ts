/**
 * Per-grid registry of mounted row DOM elements plus the stable per-key ref callbacks that keep
 * {@link DataGridRow} memoized (a fresh inline ref callback per render would defeat its shallow
 * compare). Lives outside body.tsx so the render-time callback lookup stays an opaque call —
 * the React Compiler bails on ref reads during render, and it cannot see through a foreign
 * module's Maps.
 */

/** React calls the ref callback with null on unmount, so a scrolled-out row removes its own entry — the elements Map is the sole live set. */
export type RowElementRegistry = {
  /** Mounted row elements by getRowId key. */
  elements: Map<string | number, HTMLDivElement>;
  /** The stable ref callback for a key (created once per key). */
  getCallback: (key: string | number) => (el: HTMLDivElement | null) => void;
};

// Rows churn through unique getRowId keys during a long scroll session (e.g. 100k rows) — the
// callback cache would otherwise grow unbounded. React unmounts stale rows (calling their ref
// callback with null) before this component's next render, so pruning on that same rAF-driven
// cadence is redundant work on the full-swap hot path (a Map scan for cols*rows keys every tick);
// amortize it instead, sweeping only once the cache has grown well past a live window's size.
const PRUNE_THRESHOLD = 500;

export function createRowElementRegistry(): RowElementRegistry {
  const elements = new Map<string | number, HTMLDivElement>();
  const callbacks = new Map<string | number, (el: HTMLDivElement | null) => void>();

  return {
    elements,
    getCallback(key) {
      let cb = callbacks.get(key);
      if (!cb) {
        cb = (el) => {
          if (el) elements.set(key, el);
          else {
            elements.delete(key);
            callbacks.delete(key);
          }
        };
        callbacks.set(key, cb);
        if (callbacks.size > PRUNE_THRESHOLD) {
          // defensive sweep for any key whose unmount ref-callback somehow didn't fire (should not
          // happen under normal React unmounts, but keeps the cache bounded even so).
          for (const k of callbacks.keys()) {
            if (!elements.has(k)) callbacks.delete(k);
          }
        }
      }
      return cb;
    },
  };
}
