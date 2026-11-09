"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  viewIndexes,
  type DataGridApi,
  type RowActionResult,
} from "@/registry/default/blocks/data-grid/data-grid";

type Task = { id: string; title: string; locked: boolean };

const GATE_TIMEOUT_MS = 2_000;
const SERVER_DELAYS_MS = [800, 4_000] as const;

const columns = defineColumns<Task>()([
  { id: "title", header: "Task", accessorKey: "title", type: "text", width: 180, flex: 1 },
  { id: "locked", header: "Locked", accessorKey: "locked", type: "checkbox", width: 90, readOnly: true },
] as const);

const initialRows: Task[] = ["Write the brief", "Book the room", "Send the invite", "Order lunch", "Print the badges", "Close the venue"].map((title, i) => ({
  id: `t-${i + 1}`,
  title,
  locked: i % 3 === 1,
}));
const LOCKED_IDS = new Set(initialRows.filter((row) => row.locked).map((row) => row.id));

const resultText = (result: RowActionResult) => (result.ok ? "{ ok: true }" : `{ ok: false, reason: "${result.reason}" }`);

/** A slow `onBeforeDeleteRows` server check under `gateTimeoutMs`: the log shows each `RowActionResult`, skip, and aborted gate. */
export default function DataGridRowActionResultsDemo(): ReactNode {
  const grid = useRef<DataGridApi<Task> | null>(null);
  const [serverDelayMs, setServerDelayMs] = useState<number>(SERVER_DELAYS_MS[0]);
  const [readOnly, setReadOnly] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const record = (line: string) => setLog((prev) => [line, ...prev].slice(0, 8));

  const onBeforeDeleteRows = ({ rowIds, signal }: { rowIds: readonly string[]; signal: AbortSignal }): boolean | Promise<boolean> => {
    if (rowIds.some((id) => LOCKED_IDS.has(id))) return false;
    record(`onBeforeDeleteRows asks the server about ${rowIds.join(", ")} (${serverDelayMs} ms)`);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        record(`The server allows the delete of ${rowIds.join(", ")}`);
        resolve(true);
      }, serverDelayMs);
      signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  };

  const run = (label: string, action: () => RowActionResult | undefined) => {
    const result = action();
    if (result) record(`${label} returns ${resultText(result)}`);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Click Delete first row twice, delete the locked second row, insert a row without a createRow factory, or turn on read-only. Pick the slow server: the gate times out after {GATE_TIMEOUT_MS} ms.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" variant="outline" onClick={() => run("deleteRowsAt([0])", () => grid.current?.actions.deleteRowsAt(viewIndexes([0])))}>
          Delete first row
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={() => run("deleteRowsAt([1])", () => grid.current?.actions.deleteRowsAt(viewIndexes([1])))}>
          Delete second row
        </Button>
        <Button type="button" size="xs" variant="outline" onClick={() => run('insertRow(0, "below")', () => grid.current?.actions.insertRow(0, "below"))}>
          Insert row
        </Button>
        <Button type="button" size="xs" variant={readOnly ? "default" : "outline"} aria-pressed={readOnly} onClick={() => setReadOnly((value) => !value)}>
          Read-only
        </Button>
        <div role="group" aria-label="Server answer time" className="flex gap-1">
          {SERVER_DELAYS_MS.map((ms) => (
            <Button key={ms} type="button" size="xs" variant={serverDelayMs === ms ? "default" : "outline"} aria-pressed={serverDelayMs === ms} onClick={() => setServerDelayMs(ms)}>
              Server {ms} ms
            </Button>
          ))}
        </div>
      </div>
      <DataGridProvider
        ref={grid}
        defaultData={initialRows}
        columns={columns}
        readOnly={readOnly}
        onBeforeDeleteRows={onBeforeDeleteRows}
        gateTimeoutMs={{ onBeforeDeleteRows: GATE_TIMEOUT_MS }}
        onRowActionSkipped={({ action, reason }) => record(`onRowActionSkipped: ${action}, "${reason}"`)}
        onGateAborted={({ gate, reason }) => record(`onGateAborted: ${gate}, "${reason}"`)}
      >
        <DataGridRoot className="h-[240px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
      <ul role="log" aria-label="Row action results" className="m-0 flex min-h-16 list-none flex-col gap-1 rounded-md border border-border bg-muted p-2 text-xs text-muted-foreground">
        {log.length === 0 ? <li>No action yet.</li> : log.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </div>
  );
}
