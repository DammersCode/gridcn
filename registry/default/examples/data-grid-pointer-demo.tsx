"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataGrid, defineColumns, type HeaderClickBehavior } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 100, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 130, flex: 1 },
] as const);

const BEHAVIORS: readonly HeaderClickBehavior[] = ["select", "sort", "none"];

/** Pointer selection with a mouse: drag a range, then click a header under each `headerClickBehavior`. */
export default function DataGridPointerDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(30), []);
  const [behavior, setBehavior] = useState<HeaderClickBehavior>("select");

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">headerClickBehavior</span>
        {BEHAVIORS.map((value) => (
          <Button key={value} size="sm" variant={behavior === value ? "default" : "outline"} onClick={() => setBehavior(value)}>
            {value}
          </Button>
        ))}
      </div>
      <DataGrid className="h-[320px] w-full" defaultData={rows} columns={columns} getRowId={(row) => row.id} headerClickBehavior={behavior} />
    </div>
  );
}
