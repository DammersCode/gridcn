import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import ActionsDemo from "./data-grid-actions-demo";
import CellErrorsDemo from "./data-grid-cell-errors-demo";
import CellTypesDemo from "./data-grid-cell-types-demo";
import ColumnDragDemo from "./data-grid-column-drag-demo";
import ColumnLayoutDemo from "./data-grid-column-layout-demo";
import ConditionalStylingDemo from "./data-grid-conditional-styling-demo";
import ContextMenuDemo from "./data-grid-context-menu-demo";
import CrossFieldDemo from "./data-grid-cross-field-demo";
import CustomCellDemo from "./data-grid-custom-cell-demo";
import CustomHeadersDemo from "./data-grid-custom-headers-demo";
import CustomMarkersDemo from "./data-grid-custom-markers-demo";
import DataGridDemo from "./data-grid-demo";
import EventsDemo from "./data-grid-events-demo";
import FillPatternsDemo from "./data-grid-fill-patterns-demo";
import HistoryDemo from "./data-grid-history-demo";
import I18nDemo from "./data-grid-i18n-demo";
import IoDemo from "./data-grid-io-demo";
import KeybindingsDemo from "./data-grid-keybindings-demo";
import LargeDataDemo from "./data-grid-large-data-demo";
import LazyDemo from "./data-grid-lazy-demo";
import LazyReactQueryDemo from "./data-grid-lazy-react-query-demo";
import LazySwrDemo from "./data-grid-lazy-swr-demo";
import LoadingDemo from "./data-grid-loading-demo";
import MinimalDemo from "./data-grid-minimal-demo";
import PaginationDemo from "./data-grid-pagination-demo";
import PaginationReactQueryDemo from "./data-grid-pagination-react-query-demo";
import PaginationSwrDemo from "./data-grid-pagination-swr-demo";
import PerformanceDemo from "./data-grid-performance-demo";
import PinnedRowsDemo from "./data-grid-pinned-rows-demo";
import PinningDemo from "./data-grid-pinning-demo";
import PlaygroundDemo from "./data-grid-playground-demo";
import PresenceDemo from "./data-grid-presence-demo";
import RowMarkersDemo from "./data-grid-row-markers-demo";
import RowOpsDemo from "./data-grid-row-ops-demo";
import RowReorderDemo from "./data-grid-row-reorder-demo";
import ServerSideDemo from "./data-grid-server-side-demo";
import SortListDemo from "./data-grid-sort-list-demo";
import SortingFilteringDemo from "./data-grid-sorting-filtering-demo";
import StreamingDemo from "./data-grid-streaming-demo";
import StylingPatternsDemo from "./data-grid-styling-patterns-demo";
import UrlStateDemo from "./data-grid-url-state-demo";
import ValidationDemo from "./data-grid-validation-demo";

// The url-state demo ships nuqs' app-router adapter (Next.js router context, absent in this
// isolated harness). Swap it for nuqs' router-agnostic testing adapter so the same URL-state
// hooks run in-memory; the grid and its controls render exactly as in a real Next.js app.
vi.mock("nuqs/adapters/next/app", async () => {
  const { NuqsTestingAdapter } = await import("nuqs/adapters/testing");
  const { createElement } = await import("react");
  return {
    NuqsAdapter: ({ children }: { children: ReactNode }) =>
      createElement(NuqsTestingAdapter, { searchParams: "", children }),
  };
});

// Every registry:example item, by default export — the smoke proves each demo works right after
// install with zero configuration: it renders a grid, the grid carries data rows, and the demo's
// own controls above the grid (undo/redo, toolbar, mode switches, locale select, ...) are live.
// No demo-specific deep testing — that belongs in the demos' own tests.
const DEMOS: readonly [string, ReactNode][] = [
  ["actions", <ActionsDemo key="actions" />],
  ["cell-errors", <CellErrorsDemo key="cell-errors" />],
  ["cell-types", <CellTypesDemo key="cell-types" />],
  ["column-drag", <ColumnDragDemo key="column-drag" />],
  ["column-layout", <ColumnLayoutDemo key="column-layout" />],
  ["conditional-styling", <ConditionalStylingDemo key="conditional-styling" />],
  ["context-menu", <ContextMenuDemo key="context-menu" />],
  ["cross-field", <CrossFieldDemo key="cross-field" />],
  ["custom-cell", <CustomCellDemo key="custom-cell" />],
  ["custom-headers", <CustomHeadersDemo key="custom-headers" />],
  ["custom-markers", <CustomMarkersDemo key="custom-markers" />],
  ["demo", <DataGridDemo key="demo" />],
  ["events", <EventsDemo key="events" />],
  ["fill-patterns", <FillPatternsDemo key="fill-patterns" />],
  ["history", <HistoryDemo key="history" />],
  ["i18n", <I18nDemo key="i18n" />],
  ["io", <IoDemo key="io" />],
  ["keybindings", <KeybindingsDemo key="keybindings" />],
  ["large-data", <LargeDataDemo key="large-data" />],
  ["lazy", <LazyDemo key="lazy" />],
  ["lazy-react-query", <LazyReactQueryDemo key="lazy-react-query" />],
  ["lazy-swr", <LazySwrDemo key="lazy-swr" />],
  ["loading", <LoadingDemo key="loading" />],
  ["minimal", <MinimalDemo key="minimal" />],
  ["pagination", <PaginationDemo key="pagination" />],
  ["pagination-react-query", <PaginationReactQueryDemo key="pagination-react-query" />],
  ["pagination-swr", <PaginationSwrDemo key="pagination-swr" />],
  ["performance", <PerformanceDemo key="performance" />],
  ["pinned-rows", <PinnedRowsDemo key="pinned-rows" />],
  ["pinning", <PinningDemo key="pinning" />],
  ["playground", <PlaygroundDemo key="playground" />],
  ["presence", <PresenceDemo key="presence" />],
  ["row-markers", <RowMarkersDemo key="row-markers" />],
  ["row-ops", <RowOpsDemo key="row-ops" />],
  ["row-reorder", <RowReorderDemo key="row-reorder" />],
  ["server-side", <ServerSideDemo key="server-side" />],
  ["sort-list", <SortListDemo key="sort-list" />],
  ["sorting-filtering", <SortingFilteringDemo key="sorting-filtering" />],
  ["streaming", <StreamingDemo key="streaming" />],
  ["styling-patterns", <StylingPatternsDemo key="styling-patterns" />],
  ["url-state", <UrlStateDemo key="url-state" />],
  ["validation", <ValidationDemo key="validation" />],
];

// One generic commit gesture, same for every demo: activate the first real data cell, seed the
// editor with a character, commit. Best-effort (readOnly cells simply stay put) — its value is
// unlocking state-gated controls such as history's undo/redo, which start out disabled on purpose.
async function commitFirstCell(grid: Element): Promise<void> {
  const cell = grid.querySelector<HTMLElement>('[role="row"][data-grid-row-index] [role="gridcell"][data-column-id]');
  if (!cell) return;
  await userEvent.click(cell);
  await userEvent.keyboard("a");
  await userEvent.keyboard("{Enter}");
  await new Promise((r) => setTimeout(r, 50));
}

function isLive(el: HTMLElement): boolean {
  const visible = el.offsetParent !== null || el.getClientRects().length > 0;
  if (!visible) return false;
  if (el instanceof HTMLButtonElement) return !el.disabled;
  if (el instanceof HTMLInputElement) return !el.disabled && el.type !== "hidden";
  if (el instanceof HTMLSelectElement) return !el.disabled;
  return true;
}

describe("registry demos smoke: installed demos work immediately", () => {
  for (const [name, el] of DEMOS) {
    it(`${name} renders a grid with data rows and live controls`, async () => {
      await render(el);
      // A demo that renders no grid at all is a bug, not a skip — every example ships a grid.
      await vi.waitFor(() => expect(document.querySelector('[role="grid"]')).not.toBeNull(), { timeout: 5000 });
      const grid = document.querySelector('[role="grid"]')!;
      // Async demos (lazy windows, react-query/swr pages, server-side fetch) deliver their first
      // rows after a simulated network round trip; poll until they land.
      await vi.waitFor(
        () => {
          expect(grid.querySelectorAll('[role="row"][data-grid-row-index]').length).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
      await commitFirstCell(grid);
      // Controls the demo offers above the grid (before it in document order, outside the grid
      // itself): if the demo has any, at least one must be visible and enabled. Controls below the
      // grid (e.g. the cell-errors "Clear all" bar) are out of scope — some are disabled by design
      // until an error exists.
      const controls = [...document.querySelectorAll<HTMLElement>("button, input, select")].filter(
        (el) => !grid.contains(el) && (el.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      );
      if (controls.length === 0) return;
      const live = controls.filter(isLive);
      expect(
        live.length,
        `${name}: ${controls.length} control(s) above the grid, none visible and enabled: ` +
          controls.map((c) => `${c.tagName.toLowerCase()}${(c as HTMLButtonElement).disabled ? "[disabled]" : ""}`).join(", "),
      ).toBeGreaterThan(0);
    });
  }
});
