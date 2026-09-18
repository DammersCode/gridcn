import type { ReactNode } from "react";
import DataGridSortingFilteringDemo from "@/registry/default/examples/data-grid-sorting-filtering-demo";
import DataGridSortListDemo from "@/registry/default/examples/data-grid-sort-list-demo";

/** Bare repro page: both drag&drop demos with nothing around them - no docs layout, no preview harness. */
export default function DndScrollPage(): ReactNode {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">dnd-scroll bare repro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drag&drop demos, no harness, no docs layout. Page is window-scrolled only.
        </p>
      </div>
      <div className="h-[600px]" />
      <DataGridSortListDemo />
      <div className="h-[600px]" />
      <DataGridSortingFilteringDemo />
      <div className="h-[600px]" />
    </div>
  );
}
