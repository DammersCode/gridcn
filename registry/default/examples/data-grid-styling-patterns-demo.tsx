"use client";

import { useState, type ReactNode } from "react";
import {
  DataGrid,
  defineColumns,
  type DensityMode,
  type GetRowClassName,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Deal = {
  id: string;
  account: string;
  region: "AMER" | "EMEA" | "APAC";
  owner: string;
  amount: number;
  stage: "prospecting" | "committed" | "at-risk";
};

const DEALS: Deal[] = [
  { id: "d1", account: "Northwind Traders", region: "AMER", owner: "Priya Nair", amount: 84_000, stage: "committed" },
  { id: "d2", account: "Fabrikam Group", region: "EMEA", owner: "Marcus Cole", amount: 41_500, stage: "at-risk" },
  { id: "d3", account: "Contoso Retail", region: "AMER", owner: "Dana Whitfield", amount: 120_000, stage: "committed" },
  { id: "d4", account: "Tailspin Toys", region: "APAC", owner: "Ilya Petrov", amount: 27_800, stage: "prospecting" },
  { id: "d5", account: "Wide World Importers", region: "EMEA", owner: "Grace Owusu", amount: 63_200, stage: "at-risk" },
  { id: "d6", account: "Adatum Corp", region: "APAC", owner: "Tom Bracewell", amount: 95_400, stage: "committed" },
  { id: "d7", account: "Lucerne Publishing", region: "AMER", owner: "Yuki Tanaka", amount: 18_900, stage: "prospecting" },
  { id: "d8", account: "Proseware Inc", region: "EMEA", owner: "Leah Fischer", amount: 52_700, stage: "at-risk" },
];

// Module-scope so the identity is stable across renders (row/cell memoization + dev guardrail).
const getRowClassName: GetRowClassName<Deal> = (row) =>
  row.stage === "at-risk"
    ? "border-l-2 border-l-destructive bg-destructive/5 text-destructive"
    : undefined;

const columns = defineColumns<Deal>()([
  { id: "account", header: "Account", accessorKey: "account", type: "text", width: 100, flex: 2 },
  {
    id: "region",
    header: "Region",
    accessorKey: "region",
    type: "text",
    width: 65,
    flex: 1,
    // Full-column treatment via the per-column string form: background tint, bold header, and a
    // right border to visually separate this "brand" column from the rest of the row — constant
    // across every cell/header in the column, no value-dependent logic needed.
    cellClassName: "bg-primary/5 border-r border-r-primary/30 font-medium",
    headerClassName: "bg-primary/10 border-r border-r-primary/30 font-semibold text-primary",
  },
  { id: "owner", header: "Owner", accessorKey: "owner", type: "text", width: 85, flex: 1 },
  {
    id: "amount",
    header: "Amount",
    accessorKey: "amount",
    type: "number",
    width: 75,
    flex: 1,
    cellClassName: "text-right tabular-nums",
    headerClassName: "text-right",
  },
  {
    id: "stage",
    header: "Stage",
    accessorKey: "stage",
    type: "select",
    options: {
      choices: [
        { value: "prospecting", label: "Prospecting" },
        { value: "committed", label: "Committed" },
        { value: "at-risk", label: "At risk" },
      ],
    },
    width: 80,
    flex: 1,
  },
] as const);

const DENSITY_OPTIONS: readonly DensityMode[] = ["compact", "default", "comfortable"];

/**
 * Two full-scope styling patterns the conditional-styling demo doesn't cover — a fully-styled
 * COLUMN (Region: tinted background, bold header, border, via `cellClassName`/`headerClassName`
 * string form) and a fully-styled ROW (at-risk deals: left border + text color + bg tint, beyond
 * a plain opacity dim, via `getRowClassName`) — plus a live `density`/`rowHeight` toggle.
 */
export default function DataGridStylingPatternsDemo(): ReactNode {
  const [density, setDensity] = useState<DensityMode>("default");

  return (
    <div className="w-full flex h-[420px] flex-col gap-2">
      <Select value={density} onValueChange={(value) => setDensity(value as DensityMode)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DENSITY_OPTIONS.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGrid
          defaultData={DEALS}
          columns={columns}
          getRowId={(row) => row.id}
          className="h-full rounded-none border-none"
          getRowClassName={getRowClassName}
          density={density}
        />
      </div>
    </div>
  );
}
