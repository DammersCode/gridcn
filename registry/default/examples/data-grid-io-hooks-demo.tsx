"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace, type ReplacePlan } from "@/registry/default/blocks/data-grid-find-replace/data-grid-find-replace";
import { DataGridImportDialog, useDataGridExport, type ImportContext } from "@/registry/default/blocks/data-grid-io/data-grid-io";

type Order = { id: string; name: string; price: number | null; qty: number | null; note: string };

const columns = defineColumns<Order>()([
  { id: "id", header: "Id", accessorKey: "id", type: "text", width: 70 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150, flex: 1 },
  { id: "price", header: "Price", accessorKey: "price", type: "number", width: 90 },
  {
    id: "qty",
    header: "Qty",
    accessorKey: "qty",
    type: "number",
    width: 70,
    validate: (value) => (typeof value === "number" && value < 0 ? "Qty cannot be negative" : null),
  },
  { id: "note", header: "Note", accessorKey: "note", type: "text", width: 120, hidden: true },
] as const);

const INITIAL_ROWS: Order[] = [
  { id: "A-1", name: "Desk lamp", price: 12.5, qty: 4, note: "fragile" },
  { id: "A-2", name: "Notebook", price: 3.2, qty: 10, note: "" },
  { id: "A-3", name: "Pen set", price: 8, qty: 6, note: "gift" },
  { id: "A-4", name: "Stapler", price: 6.75, qty: 2, note: "" },
];

const NL = String.fromCharCode(10);
const SAMPLE_CSV = [
  "Orders export;;;",
  "Generated 2026-11-04;;;",
  "Id;Name;Price;Qty",
  "B-1;Desk lamp;EUR 12,50;4",
  "B-2;  Notebook ;EUR 3,20;10",
  ";;;",
  "B-3;Pen set;EUR 8,00;-3",
].join(NL);

const COLUMN_IDS = ["id", "name", "price", "qty", "note"] as const;
type ColumnId = (typeof COLUMN_IDS)[number];
type Tab = "export" | "import" | "replace";

type UploadState = { status: "uploading" | "done" | "cancelled" | "failed"; fileName: string; format: string; size: number; progress: number; preview: string };

function toNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseEuro(text: string): number | null {
  return toNumber(text.replace(/^EUR\s*/, "").replace(",", "."));
}

function Toggle(props: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }): ReactNode {
  const { id, label, hint, checked, onChange } = props;
  return (
    <div className="flex items-start gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} className="mt-0.5" />
      <div className="flex min-w-0 flex-col">
        <Label htmlFor={id}>{label}</Label>
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
    </div>
  );
}

function ExportPanel(): ReactNode {
  const { exportGrid } = useDataGridExport();
  const [upload, setUpload] = useState(false);
  const [typed, setTyped] = useState(false);
  const [picked, setPicked] = useState<readonly ColumnId[]>(["id", "name", "price", "qty"]);
  const [result, setResult] = useState<UploadState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = (format: "csv" | "xlsx") => {
    if (runningRef.current) return;
    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    void exportGrid({
      format,
      fileName: "orders",
      columns: picked,
      signal: controller.signal,
      formatCell: typed ? ({ column, value, text }) => (column.id === "price" || column.id === "qty" ? (typeof value === "number" ? value : null) : text) : undefined,
      output: upload
        ? async (file, { fileName, format: fileFormat, signal }) => {
            const preview = fileFormat === "csv" ? (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).slice(0, 4).join(NL) : "Binary .xlsx file";
            const base = { fileName, format: fileFormat, size: file.size, preview };
            setResult({ ...base, status: "uploading", progress: 0 });
            await new Promise<void>((resolve, reject) => {
              let progress = 0;
              const timer = setInterval(() => {
                progress += 25;
                setResult({ ...base, status: "uploading", progress });
                if (progress >= 100) {
                  clearInterval(timer);
                  resolve();
                }
              }, 300);
              signal.addEventListener(
                "abort",
                () => {
                  clearInterval(timer);
                  reject(signal.reason);
                },
                { once: true },
              );
            });
            setResult({ ...base, status: "done", progress: 100 });
          }
        : undefined,
    })
      .catch((error: unknown) => {
        if (controller.signal.aborted) setResult((current) => (current ? { ...current, status: "cancelled" } : current));
        else setResult({ fileName: "orders", format, size: 0, progress: 0, preview: error instanceof Error ? error.message : "The export failed", status: "failed" });
      })
      .finally(() => {
        runningRef.current = false;
        if (controllerRef.current === controller) setBusy(false);
      });
  };

  return (
    <div className="flex flex-col gap-3">
      <Toggle id="hooks-upload" label="Upload instead of download" hint="output receives the finished file. Nothing is downloaded." checked={upload} onChange={setUpload} />
      <Toggle id="hooks-typed" label="Typed numbers" hint="formatCell returns numbers, so xlsx cells are numeric." checked={typed} onChange={setTyped} />
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="mb-1 text-xs text-muted-foreground">columns: the ids to write, in this order (Note is hidden in the grid)</legend>
        {COLUMN_IDS.map((id) => (
          <div key={id} className="flex items-center gap-1.5">
            <Checkbox
              id={`hooks-col-${id}`}
              checked={picked.includes(id)}
              onCheckedChange={(checked) => setPicked(COLUMN_IDS.filter((candidate) => (candidate === id ? checked === true : picked.includes(candidate))))}
            />
            <Label htmlFor={`hooks-col-${id}`}>{id}</Label>
          </div>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={picked.length === 0 || busy} onClick={() => run("csv")}>
          Export CSV
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={picked.length === 0 || busy} onClick={() => run("xlsx")}>
          Export XLSX
        </Button>
        {busy && upload && (
          <Button type="button" size="sm" variant="ghost" onClick={() => controllerRef.current?.abort()}>
            Cancel upload
          </Button>
        )}
      </div>
      {result && (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <span role="status">
            {result.status === "uploading" ? "Uploading" : result.status === "done" ? "Uploaded" : result.status === "failed" ? "Export failed" : "Upload cancelled"}: {result.fileName} · {result.format} · {result.size} bytes
          </span>
          {result.status === "uploading" && <progress className="h-2 w-full" max={100} value={result.progress} aria-label="Upload progress" />}
          <pre className="overflow-x-auto font-mono whitespace-pre">{result.preview}</pre>
        </div>
      )}
      <ExportPreview typed={typed} columns={picked} />
    </div>
  );
}

function ExportPreview(props: { typed: boolean; columns: readonly ColumnId[] }): ReactNode {
  const { typed, columns: ids } = props;
  const sample = INITIAL_ROWS[0]!;
  return (
    <p className="text-xs text-muted-foreground">
      Cell types in the first row:{" "}
      {ids.map((id) => {
        const value = sample[id];
        const numeric = typed && typeof value === "number";
        return (
          <span key={id} className="mr-2 whitespace-nowrap">
            {id}={numeric ? "number" : "text"}
          </span>
        );
      })}
    </p>
  );
}

type ImportReport = { fileName: string; rows: number; mapping: string; rejected: readonly string[] };

function ImportPanel(props: { onRows: (rows: Order[]) => void }): ReactNode {
  const { onRows } = props;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | undefined>();
  const [headerRowText, setHeaderRowText] = useState("2");
  const headerRow = Math.min(9, Math.max(0, Math.floor(Number(headerRowText)) || 0));
  const [clean, setClean] = useState(false);
  const [euro, setEuro] = useState(false);
  const [failing, setFailing] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const counter = useRef(0);

  const load = () => {
    setFile(new File([SAMPLE_CSV], "orders.csv", { type: "text/csv" }));
    setReport(null);
    setServerError(null);
    setOpen(true);
  };

  const onImport = useCallback(
    async (rows: Order[], ctx: ImportContext) => {
      setReport({
        fileName: ctx.fileName,
        rows: rows.length,
        mapping: ctx.mapping.map((entry) => `${entry.importColumnIndex}→${entry.gridColumnId ?? "skip"}`).join(" "),
        rejected: ctx.rejected.map((cell) => `row ${cell.rowIndex + 1}, column ${cell.gridColumnId}: ${cell.message ?? "rejected"}`),
      });
      if (failing) throw new Error("409 Conflict: order B-1 already exists");
      onRows(rows);
    },
    [failing, onRows],
  );

  return (
    <div className="flex flex-col gap-3">
      <Toggle id="hooks-clean" label="Clean the rows" hint="processImportRows trims every cell and drops empty rows." checked={clean} onChange={setClean} />
      <Toggle id="hooks-euro" label="Read “EUR 12,50” as a number" hint="processCellFromText parses the price column." checked={euro} onChange={setEuro} />
      <Toggle id="hooks-fail" label="Server fails" hint="onImport rejects; onImportError and the dialog show why." checked={failing} onChange={setFailing} />
      <div className="flex items-center gap-2">
        <Label htmlFor="hooks-header-row">Header row index</Label>
        <Input id="hooks-header-row" type="number" min={0} max={9} value={headerRowText} onChange={(event) => setHeaderRowText(event.target.value)} className="h-8 w-16" />
        <span className="text-xs text-muted-foreground">defaultHeaderRow: rows above it are dropped</span>
      </div>
      <div>
        <Button type="button" size="sm" onClick={load}>
          Load sample file
        </Button>
      </div>
      {report && (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <span role="status">
            onImport got {report.rows} rows from {report.fileName}
          </span>
          <span>mapping: {report.mapping}</span>
          <span>rejected: {report.rejected.length === 0 ? "none" : report.rejected.join("; ")}</span>
          {serverError && <span className="text-destructive">onImportError: {serverError}</span>}
        </div>
      )}
      <DataGridImportDialog<Order>
        open={open}
        onOpenChange={setOpen}
        file={file}
        createRow={() => ({ id: `new-${counter.current++}`, name: "", price: null, qty: null, note: "" })}
        importDefaults={{ defaultHeaderRow: headerRow }}
        processImportRows={clean ? ({ rows }) => rows.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some((cell) => cell !== "")) : undefined}
        processCellFromText={euro ? (text, { column, fromText }) => (column.id === "price" ? parseEuro(text) : fromText(text)) : undefined}
        onImport={onImport}
        onImportError={(error) => setServerError(error instanceof Error ? error.message : String(error))}
      />
    </div>
  );
}

type Review = { plan: ReplacePlan; decide: (plan: ReplacePlan | false) => void };

function ReplacePanel(props: { review: Review | null; reviewOn: boolean; setReviewOn: (on: boolean) => void; skipName: boolean; setSkipName: (on: boolean) => void; open: () => void }): ReactNode {
  const { review, reviewOn, setReviewOn, skipName, setSkipName, open } = props;
  return (
    <div className="flex flex-col gap-3">
      <Toggle id="hooks-review" label="Review the plan first" hint="processReplace holds the replace until you apply or cancel it." checked={reviewOn} onChange={setReviewOn} />
      <Toggle id="hooks-skip" label="Leave the Name column alone" hint="processReplace removes its patches from the plan." checked={skipName} onChange={setSkipName} />
      <div>
        <Button type="button" size="sm" onClick={open}>
          Open find and replace
        </Button>
      </div>
      {review && (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2 text-xs" role="status">
          <span>Plan: {review.plan.patches.length} cells</span>
          <ul className="font-mono">
            {review.plan.patches.slice(0, 5).map((patch) => (
              <li key={`${patch.rowId}-${patch.columnId}`}>
                {patch.rowId} · {patch.columnId} → {String(patch.value)}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => review.decide(review.plan)}>
              Apply
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => review.decide(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Every export, import, and replace hook in one place: each switch turns one hook on, and the panel shows what the hook received or produced. */
export default function DataGridIOHooksDemo(): ReactNode {
  const [data, setData] = useState<readonly Order[]>(INITIAL_ROWS);
  const [tab, setTab] = useState<Tab>("export");
  const [reviewOn, setReviewOn] = useState(false);
  const [skipName, setSkipName] = useState(false);
  const [review, setReview] = useState<Review | null>(null);

  const findReplace = useDataGridFindReplace({
    processReplace:
      reviewOn || skipName
        ? ({ plan, signal }) => {
            const edited: ReplacePlan = skipName ? { ...plan, patches: plan.patches.filter((patch) => patch.columnId !== "name") } : plan;
            if (!reviewOn) return edited;
            return new Promise<ReplacePlan | false>((resolve) => {
              const decide = (decision: ReplacePlan | false) => {
                setReview(null);
                resolve(decision);
              };
              signal.addEventListener("abort", () => decide(false), { once: true });
              setReview({ plan: edited, decide });
            });
          }
        : undefined,
  });

  const onRows = useCallback((rows: Order[]) => setData((current) => [...current, ...rows]), []);

  return (
    <div className="flex w-full flex-col gap-3">
      <DataGridProvider data={data} columns={columns} onDataChange={setData} plugins={[findReplace.plugin]}>
        <div className="flex h-[240px] min-w-0 flex-col overflow-hidden rounded-md border border-border">
          <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </div>
        <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3 text-sm">
          <div className="flex gap-1" role="group" aria-label="Hooks">
            {(["export", "import", "replace"] as const).map((id) => (
              <Button key={id} type="button" size="sm" aria-pressed={tab === id} variant={tab === id ? "default" : "ghost"} onClick={() => setTab(id)}>
                {id === "export" ? "Export" : id === "import" ? "Import" : "Replace"}
              </Button>
            ))}
          </div>
          <div hidden={tab !== "export"}>
            <ExportPanel />
          </div>
          <div hidden={tab !== "import"}>
            <ImportPanel onRows={onRows} />
          </div>
          <div hidden={tab !== "replace"}>
            <ReplacePanel review={review} reviewOn={reviewOn} setReviewOn={setReviewOn} skipName={skipName} setSkipName={setSkipName} open={() => findReplace.open("replace")} />
          </div>
        </div>
      </DataGridProvider>
    </div>
  );
}
