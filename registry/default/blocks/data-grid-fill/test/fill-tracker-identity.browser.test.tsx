import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridStoreApi,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "../data-grid-fill";

/**
 * Regression test for the "fresh component identity per render" defect (2026-08-02 optimization
 * audit, api-dx/addons): `useDataGridFill`'s returned `FillHandleTracker` used to be a brand-new
 * arrow function on every render of the calling component, so React compared it by `type`
 * reference and remounted the tracker subtree on every unrelated re-render — dropping an
 * in-progress drag and orphaning the fill preview. `_registerFillHandlers` (store/create-store.ts)
 * is the tracker's own real mount/unmount signal (registers handlers on mount, `null` on unmount,
 * see fill-tracker.tsx's first effect) — counting its non-null writes is a code-unmodified way to
 * observe the tracker's mount count from outside.
 */

type Row = { id: string; label: string; value: number };

const columns = defineColumns<Row>()([
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120 },
  { id: "value", header: "Value", accessorKey: "value", type: "number", width: 100 },
] as const);

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, label: `L${i}`, value: i }));
}

describe("useDataGridFill: FillHandleTracker identity across parent re-renders", () => {
  it("mounts the tracker exactly once across N unrelated parent re-renders (a keystroke-driven consumer, per fill-handle.mdx's own pattern)", async () => {
    let mountCount = 0;
    let bumpUnrelatedState: (() => void) | null = null;

    function StoreObserver() {
      const storeApi = useDataGridStoreApi();
      storeApi.subscribe((state, prev) => {
        // fillHandlers flips null -> non-null exactly once per FillHandleTracker mount.
        if (state.fillHandlers !== null && prev.fillHandlers === null) mountCount += 1;
      });
      return null;
    }

    function Harness() {
      // Mirrors the documented (and audit-flagged) consumer shape: useDataGridFill called in the
      // same component that owns unrelated re-render-triggering state (a keystroke, a selection
      // change, anything besides disabled/onFill themselves).
      const [tick, setTick] = useState(0);
      bumpUnrelatedState = () => setTick((t) => t + 1);
      const { plugin, FillHandleTracker } = useDataGridFill({});
      return (
        <DataGridProvider data={makeRows(4)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <StoreObserver />
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
            <FillHandleTracker />
          </DataGridRoot>
          <span data-testid="tick">{tick}</span>
        </DataGridProvider>
      );
    }

    render(
      <div style={{ height: 400 }}>
        <Harness />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(mountCount).toBe(1);

    for (let i = 0; i < 5; i++) {
      bumpUnrelatedState!();
      await expect.element(page.getByTestId("tick")).toHaveTextContent(String(i + 1));
    }

    expect(mountCount).toBe(1);
  });
});
