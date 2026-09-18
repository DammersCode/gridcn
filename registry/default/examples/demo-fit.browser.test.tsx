import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import CellErrorsDemo from "@/registry/default/examples/data-grid-cell-errors-demo";
import CellTypesDemo from "@/registry/default/examples/data-grid-cell-types-demo";
import ConditionalStylingDemo from "@/registry/default/examples/data-grid-conditional-styling-demo";
import ContextMenuDemo from "@/registry/default/examples/data-grid-context-menu-demo";
import CustomCellDemo from "@/registry/default/examples/data-grid-custom-cell-demo";
import CustomHeadersDemo from "@/registry/default/examples/data-grid-custom-headers-demo";
import CustomMarkersDemo from "@/registry/default/examples/data-grid-custom-markers-demo";
import DataGridDemo from "@/registry/default/examples/data-grid-demo";
import EventsDemo from "@/registry/default/examples/data-grid-events-demo";
import FillPatternsDemo from "@/registry/default/examples/data-grid-fill-patterns-demo";
import HistoryDemo from "@/registry/default/examples/data-grid-history-demo";
import I18nDemo from "@/registry/default/examples/data-grid-i18n-demo";
import IoDemo from "@/registry/default/examples/data-grid-io-demo";
import KeybindingsDemo from "@/registry/default/examples/data-grid-keybindings-demo";
import LazyDemo from "@/registry/default/examples/data-grid-lazy-demo";
import LoadingDemo from "@/registry/default/examples/data-grid-loading-demo";
import MinimalDemo from "@/registry/default/examples/data-grid-minimal-demo";
import PaginationDemo from "@/registry/default/examples/data-grid-pagination-demo";
import PinnedRowsDemo from "@/registry/default/examples/data-grid-pinned-rows-demo";
import PresenceDemo from "@/registry/default/examples/data-grid-presence-demo";
import RowMarkersDemo from "@/registry/default/examples/data-grid-row-markers-demo";
import SortListDemo from "@/registry/default/examples/data-grid-sort-list-demo";
import SortingFilteringDemo from "@/registry/default/examples/data-grid-sorting-filtering-demo";
import StreamingDemo from "@/registry/default/examples/data-grid-streaming-demo";
import StylingPatternsDemo from "@/registry/default/examples/data-grid-styling-patterns-demo";
import ValidationDemo from "@/registry/default/examples/data-grid-validation-demo";

// A docs demo whose columns overflow its own fixed-height, overflow-hidden container renders as a
// visibly clipped grid with unreachable columns (fill-patterns shipped that way, 610px of columns
// in a 402px box). Columns must fit the preview width unless the demo is deliberately about
// horizontal scrolling or scale, in which case it belongs in ALLOWED_OVERFLOW below with a reason.
const DEMOS = [
  ["fill-patterns", <FillPatternsDemo key="fill-patterns" />],
  ["validation", <ValidationDemo key="validation" />],
  ["cell-errors", <CellErrorsDemo key="cell-errors" />],
  ["loading", <LoadingDemo key="loading" />],
  ["i18n", <I18nDemo key="i18n" />],
  ["cell-types", <CellTypesDemo key="cell-types" />],
  ["conditional-styling", <ConditionalStylingDemo key="conditional-styling" />],
  ["context-menu", <ContextMenuDemo key="context-menu" />],
  ["custom-cell", <CustomCellDemo key="custom-cell" />],
  ["custom-headers", <CustomHeadersDemo key="custom-headers" />],
  ["custom-markers", <CustomMarkersDemo key="custom-markers" />],
  ["demo", <DataGridDemo key="demo" />],
  ["events", <EventsDemo key="events" />],
  ["history", <HistoryDemo key="history" />],
  ["io", <IoDemo key="io" />],
  ["keybindings", <KeybindingsDemo key="keybindings" />],
  ["lazy", <LazyDemo key="lazy" />],
  ["minimal", <MinimalDemo key="minimal" />],
  ["pagination", <PaginationDemo key="pagination" />],
  ["pinned-rows", <PinnedRowsDemo key="pinned-rows" />],
  ["presence", <PresenceDemo key="presence" />],
  ["row-markers", <RowMarkersDemo key="row-markers" />],
  ["sort-list", <SortListDemo key="sort-list" />],
  ["sorting-filtering", <SortingFilteringDemo key="sorting-filtering" />],
  ["streaming", <StreamingDemo key="streaming" />],
  ["styling-patterns", <StylingPatternsDemo key="styling-patterns" />],
] as const;

// Demos deliberately outside the "fit the preview" rule, each with a one-line reason. Not blanket
// skips: every entry here is a demo whose whole point is more columns/rows than a ~415px preview
// can show without either losing the lesson or contradicting it, or that cannot mount in this
// isolated browser harness for reasons unrelated to column fit.
const ALLOWED_OVERFLOW = [
  ["large-data", "100k-row demo: the lesson is virtualization at scale, its 7-column, real-world-width table is the point"],
  ["performance", "100k-row FPS demo: shares large-data's column set on purpose, to show the same scale under a live FPS readout"],
  ["pinning", "pin-left/right demo: the lesson is columns pinned across a scrolled middle region, so a scrollable body is required"],
  ["playground", "kitchen-sink demo: every feature toggle live at once, deliberately more columns than a single preview width"],
  ["url-state", "nuqs's app-router NuqsAdapter needs Next's router context, unavailable in this isolated harness — unrelated to column fit"],
] as const;

describe("demo columns fit their preview container", () => {
  for (const [name, el] of DEMOS) {
    it(`${name} demo has no horizontal overflow`, async () => {
      render(el);
      await new Promise((r) => setTimeout(r, 400));
      const grid = document.querySelector('[role="grid"]') as HTMLElement | null;
      expect(grid).not.toBeNull();
      expect(grid!.scrollWidth).toBeLessThanOrEqual(Math.ceil(grid!.getBoundingClientRect().width) + 1);
    });
  }

  for (const [name, reason] of ALLOWED_OVERFLOW) {
    it.skip(`${name} demo has no horizontal overflow (allowed: ${reason})`, () => {});
  }
});
