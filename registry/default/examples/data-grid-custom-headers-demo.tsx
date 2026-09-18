"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus, TrendingDown, TrendingUp, User } from "lucide-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridSortState,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

/**
 * The sort-direction state icon: reads live grid state, so clicking the header (sort mode)
 * cycles unsorted -> asc -> desc and this icon follows: a muted minus when unsorted, an up
 * icon when ascending, a down icon when descending.
 */
function SortStateIcon(props: { columnId: string; unsorted: ReactNode; asc: ReactNode; desc: ReactNode }): ReactNode {
  const sortState = useDataGridSortState();
  const entry = sortState.find((spec) => spec.columnId === props.columnId);
  const stateIcon = entry?.direction === "asc" ? props.asc : entry?.direction === "desc" ? props.desc : props.unsorted;
  return <span className="flex shrink-0 items-center">{stateIcon}</span>;
}

const unsortedIcon = <Minus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;

const columns = defineColumns<DemoRow>()([
  {
    id: "name",
    header: (
      <span className="flex items-center gap-1.5">
        <User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        Name
        <SortStateIcon
          columnId="name"
          unsorted={unsortedIcon}
          asc={<ArrowUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          desc={<ArrowDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        />
      </span>
    ),
    headerText: "Name",
    accessorKey: "name",
    type: "text",
    width: 150,
  },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 140 },
  {
    id: "score",
    header: (
      <span className="flex items-center gap-1.5">
        Score
        <SortStateIcon
          columnId="score"
          unsorted={unsortedIcon}
          asc={<TrendingUp className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          desc={<TrendingDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        />
      </span>
    ),
    headerText: "Score",
    accessorKey: "score",
    type: "number",
    width: 90,
  },
] as const);

/**
 * `ColumnDef.header` takes a component, not just a string: the header subscribes to live grid
 * state and re-renders when it changes. In `sort` header-click mode a custom header owns its
 * display (the built-in arrow is only appended to string headers, like Email's).
 */
export default function DataGridCustomHeadersDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(10), []);

  return (
    <div className="w-full flex h-[360px] flex-col gap-2">
      <span className="text-sm text-muted-foreground">
        Click the Name or Score header to sort: a minus means unsorted, an up icon ascending, a down icon descending.
      </span>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} headerClickBehavior="sort">
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
