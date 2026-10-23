"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace } from "@/registry/default/blocks/data-grid-find-replace/data-grid-find-replace";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160, flex: 2 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, flex: 1 },
] as const);

export default function DataGridFindReplaceDemo(): ReactNode {
  const [rows, setRows] = useState<readonly DemoRow[]>(() => generateDemoRows(200));
  const findReplace = useDataGridFindReplace();
  const history = useDataGridHistory<DemoRow>();
  const plugins = useMemo(() => [history.plugin, findReplace.plugin], [history.plugin, findReplace.plugin]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => findReplace.open()}>
          Find and replace
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!history.canUndo} onClick={history.undo}>
          Undo
        </Button>
        <p className="m-0 text-sm text-muted-foreground">Press Ctrl+H inside the grid to open the panel.</p>
      </div>
      <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} plugins={plugins} onDataChange={setRows}>
        <DataGridRoot className="h-[360px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
