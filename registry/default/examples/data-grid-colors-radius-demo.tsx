"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 2 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 80, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

const RADII = ["0", "0.625rem", "1rem"] as const;
const TINT = "oklch(0.55 0.2 300)";

/** The grid takes its corners from `--radius`, its accent from `--primary`, and its surfaces from the `.dark` tokens. */
export default function DataGridColorsRadiusDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(20), []);
  const [radius, setRadius] = useState<(typeof RADII)[number]>("0.625rem");
  const [tinted, setTinted] = useState(false);
  const [dark, setDark] = useState(false);
  const style = { "--radius": radius, ...(tinted ? { "--primary": TINT } : {}) } as CSSProperties;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">--radius</span>
        {RADII.map((value) => (
          <Button key={value} size="sm" variant={radius === value ? "default" : "outline"} onClick={() => setRadius(value)}>
            {value}
          </Button>
        ))}
        <Button size="sm" variant={tinted ? "default" : "outline"} onClick={() => setTinted(!tinted)}>
          Tinted primary
        </Button>
        <Button size="sm" variant={dark ? "default" : "outline"} onClick={() => setDark(!dark)}>
          Dark
        </Button>
      </div>
      <div className={dark ? "dark rounded-md bg-background p-3 text-foreground" : "rounded-md bg-background p-3 text-foreground"} style={style}>
        <DataGrid className="h-[280px] w-full" defaultData={rows} columns={columns} getRowId={(row) => row.id} />
      </div>
    </div>
  );
}
