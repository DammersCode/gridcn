"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import Joi from "joi";
import { z } from "zod";
import * as v from "valibot";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridState } from "@/registry/default/blocks/data-grid-history/data-grid-history";
import { Toaster } from "@/components/ui/sonner";

type ValidationRow = {
  id: string;
  name: string;
  age: number;
  email: string;
  sku: string;
  price: string;
  notes: string;
  score: number;
  code: string;
  tag: string;
};

const TAKEN_SKUS = new Set(["SKU-001", "SKU-002"]);

/** Fake async uniqueness check: ~800ms latency, rejects anything already in TAKEN_SKUS. */
function isSkuFree(sku: string): Promise<boolean> {
  return new Promise((resolve) => setTimeout(() => resolve(!TAKEN_SKUS.has(sku)), 800));
}

/** Hand-rolled Standard Schema (no library dependency): rejects a taken SKU, async. */
const skuSchema = {
  "~standard": {
    version: 1,
    vendor: "gridcn-demo",
    validate: async (value: unknown) => {
      const sku = String(value);
      const free = await isSkuFree(sku);
      return free ? { value: sku } : { issues: [{ message: "Already in use" }] };
    },
  },
};

/** Hand-rolled Standard Schema, sync: rejects a value without an "@", trims whitespace. */
const emailSchema = {
  "~standard": {
    version: 1,
    vendor: "gridcn-demo",
    validate: (value: unknown) => {
      const email = String(value).trim();
      return email.includes("@") ? { value: email } : { issues: [{ message: "Must contain @" }] };
    },
  },
};

/** Coercing schema: "42.9" commits as the rounded integer 43, not the raw text. */
const roundedPriceSchema = {
  "~standard": {
    version: 1,
    vendor: "gridcn-demo",
    validate: (value: unknown) => {
      const n = Number(value);
      return Number.isNaN(n) ? { issues: [{ message: "Must be a number" }] } : { value: Math.round(n) };
    },
  },
};

/** One column per major Standard Schema library, so the reader can break each one and see its own error message. */
const zodScoreSchema = z.number().int().min(0).max(100);
const joiCodeSchema = Joi.string().pattern(/^[A-Z0-9-]+$/).empty("").messages({ "string.pattern.base": "Use uppercase letters, digits, or dashes" });
const valibotTagSchema = v.pipe(v.string(), v.minLength(3));

const columns = defineColumns<ValidationRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 56, flex: 1 },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    type: "number",
    // validate is plain consumer code, so side effects like a toast need no extra grid API;
    // the stable id collapses a bulk paste's per-cell rejections into one toast.
    validate: (value: unknown) => {
      if (typeof value === "number" && value < 18) {
        toast.error("Age must be 18 or older", { id: "age-rule" });
        return "Must be 18 or older";
      }
      return null;
    },
    width: 40,
    flex: 1,
  },
  {
    id: "email",
    header: "Email",
    accessorKey: "email",
    type: "text",
    validate: emailSchema as never,
    width: 52,
    flex: 1,
  },
  {
    id: "sku",
    header: "SKU",
    accessorKey: "sku",
    type: "text",
    validate: skuSchema as never,
    width: 44,
    flex: 1,
  },
  {
    id: "price",
    header: "Price",
    accessorKey: "price",
    type: "text",
    validate: roundedPriceSchema as never,
    width: 40,
    flex: 1,
  },
  {
    id: "notes",
    header: "Notes",
    accessorKey: "notes",
    type: "text",
    // soft rule (validationMode: "warn"): the value commits and the cell stays flagged until a valid
    // re-commit clears it — the editor CLOSES on commit, unlike a blocking rejection
    validate: (value: unknown) => (typeof value === "string" && value.length > 12 ? "Max 12 characters" : null),
    validationMode: "warn",
    width: 44,
    flex: 1,
  },
  {
    id: "score",
    header: "Zod Score",
    accessorKey: "score",
    type: "number",
    validate: zodScoreSchema,
    width: 46,
    flex: 1,
  },
  {
    id: "code",
    header: "Joi Code",
    accessorKey: "code",
    type: "text",
    validate: joiCodeSchema,
    width: 44,
    flex: 1,
  },
  {
    id: "tag",
    header: "Valibot Tag",
    accessorKey: "tag",
    type: "text",
    validate: valibotTagSchema,
    width: 42,
    flex: 1,
  },
] as const);

function initialRows(): ValidationRow[] {
  return [
    { id: "row-0", name: "Ada Lovelace", age: 28, email: "ada@example.com", sku: "SKU-101", price: "42", notes: "First algorithm", score: 87, code: "ADA-1843", tag: "math" },
    { id: "row-1", name: "Grace Hopper", age: 34, email: "grace@example.com", sku: "SKU-102", price: "18", notes: "Compiled it", score: 94, code: "GRACE-1906", tag: "compilers" },
    { id: "row-2", name: "Alan Turing", age: 41, email: "alan@example.com", sku: "SKU-103", price: "99", notes: "Broke Enigma", score: 99, code: "TURING-1912", tag: "computability" },
    { id: "row-3", name: "Katherine Johnson", age: 25, email: "katherine@example.com", sku: "SKU-104", price: "7", notes: "Trajectory math", score: 91, code: "KATH-1918", tag: "orbital" },
    { id: "row-4", name: "Margaret Hamilton", age: 22, email: "margaret@example.com", sku: "SKU-105", price: "56", notes: "Apollo nav", score: 96, code: "MARG-1936", tag: "software" },
    { id: "row-5", name: "Radia Perlman", age: 30, email: "radia@example.com", sku: "SKU-106", price: "31", notes: "Spanning trees", score: 88, code: "RADIA-1951", tag: "networking" },
    { id: "row-6", name: "Tim Berners-Lee", age: 19, email: "tim@example.com", sku: "SKU-107", price: "64", notes: "Invented the web", score: 98, code: "TIM-1955", tag: "web" },
    { id: "row-7", name: "Barbara Liskov", age: 45, email: "barbara@example.com", sku: "SKU-108", price: "12", notes: "Subtyping", score: 93, code: "BARB-1939", tag: "types" },
  ];
}

const getRowId = (row: ValidationRow) => row.id;

const RULES = [
  ["Age", "18 or older. Also fires a toast.", "Blocking"],
  ["Email", "Must contain an @.", "Blocking"],
  ["SKU", "SKU-001 and SKU-002 are taken. The check takes about 800 ms and the input is read-only meanwhile.", "Blocking"],
  ["Price", "Must be a number. A decimal commits rounded: 42.9 becomes 43.", "Blocking"],
  ["Notes", "At most 12 characters.", "Soft"],
  ["Zod Score", "Integer from 0 to 100.", "Blocking"],
  ["Joi Code", "Uppercase letters, digits, or dashes.", "Blocking"],
  ["Valibot Tag", "At least 3 characters.", "Blocking"],
] as const;

/**
 * Eight rejection paths in one grid: a sync function (Age), three hand-rolled Standard Schemas
 * (Email sync, SKU async with a visible pending state, Price coercing), a soft validationMode rule
 * (Notes), and one column per major library that implements Standard Schema natively — Zod
 * (Score), Joi (Code), Valibot (Tag). The rules are listed above the grid so the reader breaks
 * them by typing and sees the error message; pasting a column of mixed
 * valid/invalid ages shows the bulk path (valid cells commit, invalid ones drop).
 */
export default function DataGridValidationDemo(): ReactNode {
  const grid = useDataGridState(initialRows(), { getRowId });

  return (
    <div className="w-full flex flex-col gap-3">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pe-4 font-medium">Column</th>
            <th className="py-1 pe-4 font-medium">Rule</th>
            <th className="py-1 font-medium">Kind</th>
          </tr>
        </thead>
        <tbody>
          {RULES.map(([column, rule, kind]) => (
            <tr key={column} className="border-t border-border align-top">
              <td className="py-1 pe-4 font-medium whitespace-nowrap">{column}</td>
              <td className="py-1 pe-4 text-muted-foreground">{rule}</td>
              <td className="py-1 whitespace-nowrap">{kind}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Every message:</span> hover the cell to read
          it, also while the editor is open (the browser shows it as a native tooltip).
        </li>
        <li>
          <span className="font-medium text-foreground">Blocking rule:</span> Enter, Tab, or a click
          on another cell keeps the editor open, and the value does not commit. The message also
          shows in a line next to the cell. Escape cancels the edit and restores the old value.
        </li>
        <li>
          <span className="font-medium text-foreground">Soft rule (Notes):</span> the value commits
          and the editor closes. The cell stays flagged. If you edit it again, the line shows next to
          the cell. A valid value clears the flag.
        </li>
        <li>
          <span className="font-medium text-foreground">Paste:</span> copy a column of ages (some
          under 18) and paste it onto Age. Valid cells commit and invalid cells drop. Notes drops
          its invalid cells on paste too.
        </li>
      </ul>
      <div className="h-80 overflow-hidden rounded-md border border-border">
        <DataGrid
          data={grid.data}
          columns={columns}
          getRowId={grid.getRowId}
          onDataChange={grid.onDataChange}
          className="h-full rounded-none border-none"
        />
      </div>
      <Toaster />
    </div>
  );
}
