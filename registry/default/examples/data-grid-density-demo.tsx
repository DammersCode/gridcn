"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataGrid, defineColumns, type DensityMode } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 100, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 130, flex: 1 },
] as const);

const DENSITIES: readonly DensityMode[] = ["compact", "default", "comfortable"];

/** The three `density` presets on one grid. */
export default function DataGridDensityDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(30), []);
  const [density, setDensity] = useState<DensityMode>("default");

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">density</span>
        {DENSITIES.map((value) => (
          <Button key={value} size="sm" variant={density === value ? "default" : "outline"} onClick={() => setDensity(value)}>
            {value}
          </Button>
        ))}
      </div>
      <DataGrid className="h-[320px] w-full" defaultData={rows} columns={columns} getRowId={(row) => row.id} density={density} />
    </div>
  );
}
