import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFill } from "../data-grid-fill";

/**
 * Regression test for the "fresh component identity per render" defect (2026-08-02 optimization
 * audit, api-dx/addons): `useDataGridFill`'s returned plugin used to be re-created on every render
 * of the calling component, so React compared its `Overlay`/`Mount` components by type reference
 * and remounted the fill subtree on every unrelated re-render — dropping an in-progress drag and
 * orphaning the fill preview. The fill handle's DOM node ([data-grid-fill-handle]) is the mount
 * signal: it renders once the plugin's Mount has registered the pointer handler, and a subtree
 * remount replaces the node (counted as a fresh mount by the MutationObserver below).
 */

type Row = { id: string; label: string; value: number };

const columns = defineColumns<Row>()([
  { id: "label", header: "Label", accessorKey: "label", type: "text", width: 120 },
  { id: "value", header: "Value", accessorKey: "value", type: "number", width: 100 },
] as const);

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, label: `L${i}`, value: i }));
}

describe("useDataGridFill: plugin component identity across parent re-renders", () => {
  it("mounts the fill subtree exactly once across N unrelated parent re-renders (a keystroke-driven consumer, per fill-handle.mdx's own pattern)", async () => {
    let handleMounts = 0;
    let bumpUnrelatedState: (() => void) | null = null;
    let select: (() => void) | null = null;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.getAttribute("data-grid-fill-handle") !== null) handleMounts += 1;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function ActionsCapture() {
      const actions = useDataGridActions();
      select = () => actions.selectCellAt({ col: 1, row: 0 });
      return null;
    }

    function Harness() {
      // Mirrors the documented (and audit-flagged) consumer shape: useDataGridFill called in the
      // same component that owns unrelated re-render-triggering state (a keystroke, a selection
      // change, anything besides disabled/onFill themselves).
      const [tick, setTick] = useState(0);
      bumpUnrelatedState = () => setTick((t) => t + 1);
      const { plugin } = useDataGridFill({});
      return (
        <DataGridProvider data={makeRows(4)} columns={columns} getRowId={(r) => r.id} plugins={[plugin]}>
          <ActionsCapture />
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
          <span data-testid="tick">{tick}</span>
        </DataGridProvider>
      );
    }

    await render(
      <div style={{ height: 400 }}>
        <Harness />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(handleMounts).toBe(0); // no selection yet — the handle is hidden

    select!();
    // the handle renders only after the plugin's Mount has registered the pointer handler
    await vi.waitFor(() => expect(document.querySelector("[data-grid-fill-handle]")).not.toBeNull());
    expect(handleMounts).toBe(1);

    for (let i = 0; i < 5; i++) {
      bumpUnrelatedState!();
      await expect.element(page.getByTestId("tick")).toHaveTextContent(String(i + 1));
    }

    // an unstable plugin identity would have remounted the overlay subtree and re-added the node
    expect(handleMounts).toBe(1);
    observer.disconnect();
  });
});
