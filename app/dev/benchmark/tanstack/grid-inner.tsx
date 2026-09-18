"use client";

import { useRef, useState, type ReactNode } from "react";
import { flexRender } from "@tanstack/react-table";
import { useLegacyTable, type LegacyColumnDef } from "@tanstack/react-table/legacy";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatJoined, formatScore, type BenchmarkRow } from "../_lib/dataset";

const ROW_HEIGHT = 36;

/**
 * Read-only renderings that match the other grids' *visual* output as closely as a library with no
 * editing layer can. Parity gaps (no dropdown, no calendar, no toggle) are recorded in _lib/parity.ts.
 */
const columns: LegacyColumnDef<BenchmarkRow>[] = [
  { accessorKey: "id", header: "ID", size: 120 },
  { accessorKey: "name", header: "Name", size: 180 },
  { accessorKey: "email", header: "Email", size: 220 },
  { accessorKey: "age", header: "Age", size: 80 },
  {
    accessorKey: "active",
    header: "Active",
    size: 100,
    cell: (ctx) => <span aria-label={ctx.getValue() ? "true" : "false"}>{ctx.getValue() ? "✓" : "–"}</span>,
  },
  {
    accessorKey: "role",
    header: "Role",
    size: 140,
    cell: (ctx) => (
      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{String(ctx.getValue() ?? "")}</span>
    ),
  },
  { accessorKey: "joined", header: "Joined", size: 140, cell: (ctx) => formatJoined(String(ctx.getValue() ?? "")) },
  { accessorKey: "score", header: "Score", size: 100, cell: (ctx) => formatScore(Number(ctx.getValue() ?? 0)) },
];

type CellCoord = { row: number; col: number };

/** Half-open rectangle covering the two anchor coords, inclusive on both ends (Excel-style range). */
function rangeContains(anchor: CellCoord, active: CellCoord, target: CellCoord): boolean {
  const minRow = Math.min(anchor.row, active.row);
  const maxRow = Math.max(anchor.row, active.row);
  const minCol = Math.min(anchor.col, active.col);
  const maxCol = Math.max(anchor.col, active.col);
  return target.row >= minRow && target.row <= maxRow && target.col >= minCol && target.col <= maxCol;
}

export default function TanstackGridInner({ rows }: { rows: BenchmarkRow[] }): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<CellCoord | null>(null);
  const [active, setActive] = useState<CellCoord | null>(null);
  const [dragging, setDragging] = useState(false);

  const table = useLegacyTable({
    data: rows,
    columns,
  });

  const tableRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const headerGroups = table.getHeaderGroups();
  const columnCount = columns.length;

  const startDrag = (row: number, col: number) => {
    setAnchor({ row, col });
    setActive({ row, col });
    setDragging(true);
  };
  const dragOver = (row: number, col: number) => {
    if (dragging) setActive({ row, col });
  };
  const endDrag = () => setDragging(false);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  return (
    <div
      ref={parentRef}
      role="grid"
      className="h-full w-full overflow-auto rounded-md border border-border"
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      data-benchmark-grid-root
    >
      <div style={{ minWidth: columnCount * 150 }}>
        <div className="sticky top-0 z-10 flex bg-muted" role="row">
          {headerGroups.map((hg) =>
            hg.headers.map((header) => (
              <div
                key={header.id}
                role="columnheader"
                className="shrink-0 border-b border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                style={{ width: header.getSize() }}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            )),
          )}
        </div>
        <div style={{ height: paddingTop }} />
        {virtualItems.map((virtualRow) => {
          const row = tableRows[virtualRow.index];
          if (!row) return null;
          return (
            <div key={row.id} role="row" className="flex" style={{ height: ROW_HEIGHT }}>
              {row.getVisibleCells().map((cell, colIndex) => {
                const coord: CellCoord = { row: virtualRow.index, col: colIndex };
                const selected = anchor && active ? rangeContains(anchor, active, coord) : false;
                return (
                  <div
                    key={cell.id}
                    role="gridcell"
                    className={`shrink-0 truncate border-b border-r border-border px-2 py-1.5 text-sm select-none ${selected ? "bg-primary/20" : ""}`}
                    style={{ width: cell.column.getSize() }}
                    onMouseDown={() => startDrag(virtualRow.index, colIndex)}
                    onMouseEnter={() => dragOver(virtualRow.index, colIndex)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={{ height: paddingBottom }} />
      </div>
    </div>
  );
}
