"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  useDataGridPresence,
  type PresenceHighlightEntry,
} from "@/registry/default/blocks/data-grid-presence/data-grid-presence";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 85, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 100, flex: 2 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 55, flex: 1 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 70, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 55, flex: 1 },
] as const);

const ROW_COUNT = 24;
const COL_COUNT = columns.length;

/** Fixed simulated users — stable id/name/color, matching the real transport's `PresenceHighlight.id` contract. */
const SIMULATED_USERS: { id: string; name: string; color: string }[] = [
  { id: "ada", name: "Ada", color: "#e11d48" },
  { id: "grace", name: "Grace", color: "#2563eb" },
  { id: "linus", name: "Linus", color: "#16a34a" },
];

/** Deterministic pseudo-random walk so the demo is reproducible across renders (no Math.random). */
function nextWalkStep(current: number, max: number, seed: number): number {
  const delta = ((seed % 5) - 2) as number; // -2..2
  return Math.max(0, Math.min(max, current + delta));
}

/**
 * Drives the 3 simulated users' selections on a timer, calling the real (imperative) mechanism
 * `setPresenceHighlights` directly — exactly what a websocket/CRDT handler would do on each remote
 * update. Ada and Grace use the view-space `range` form; Linus uses the rowId-native `{ rowId,
 * columnId }` form (a real peer would send this after a local sort or filter), so its highlight
 * keeps tracking the same row even as `headerClickBehavior="sort"` reorders the view underneath
 * it. Renders nothing itself.
 */
function useSimulatedPresenceDriver(rows: readonly DemoRow[], setPresenceHighlights: (highlights: PresenceHighlightEntry[]) => void): void {
  const tickRef = useRef(0);

  useEffect(() => {
    const positions = SIMULATED_USERS.slice(0, 2).map((_, i) => ({ row: (i * 7) % ROW_COUNT, col: i % COL_COUNT }));
    const linusRowId = rows[Math.floor(ROW_COUNT / 2)]?.id ?? rows[0]?.id ?? "";
    const linusColumnId = columns[COL_COUNT - 1]!.id;

    const interval = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;

      // Ada (index 0) periodically selects a 2-row range overlapping Grace's cell — shows blend
      // legibility when two highlights cover the same cell (spec: "one user periodically selects
      // a range overlapping another").
      const overlapTick = tick % 6 === 0;

      const rangeHighlights: PresenceHighlightEntry[] = SIMULATED_USERS.slice(0, 2).map((user, i) => {
        // positions has one entry per SIMULATED_USERS.slice(0, 2) index, so i is always in-bounds
        const pos = positions[i]!;
        pos.row = nextWalkStep(pos.row, ROW_COUNT - 1, tick * (i + 3) + i);
        pos.col = nextWalkStep(pos.col, COL_COUNT - 1, tick * (i + 5) + i);

        const range =
          i === 0 && overlapTick
            ? { x: positions[1]!.col, y: positions[1]!.row, width: 1, height: 2 } // SIMULATED_USERS has 3 fixed entries
            : { x: pos.col, y: pos.row, width: 1, height: 1 };

        return { id: user.id, color: user.color, range, label: user.name };
      });

      const linus = SIMULATED_USERS[2]!; // SIMULATED_USERS has 3 fixed entries
      const linusHighlight: PresenceHighlightEntry = {
        id: linus.id,
        color: linus.color,
        rowId: linusRowId,
        columnId: linusColumnId,
        label: linus.name,
      };

      setPresenceHighlights([...rangeHighlights, linusHighlight]);
    }, 900);

    return () => clearInterval(interval);
  }, [rows, setPresenceHighlights]);
}

/**
 * Multiplayer presence highlights (docs/multiplayer-presence): 3 simulated users move their
 * cell/range selections on a timer via `setPresenceHighlights` — the same imperative mechanism a
 * real websocket/CRDT handler would call. Zero core re-renders: only the plugin's own overlay
 * subscribes to this state (see the render-count probe in data-grid-presence.test.tsx). Click a
 * header to sort (`headerClickBehavior="sort"`) and watch Linus's highlight — sent as a `{ rowId,
 * columnId }` entry — keep following the same row instead of a fixed view position.
 */
export default function DataGridPresenceDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(ROW_COUNT), []);
  const { plugin, setPresenceHighlights } = useDataGridPresence();
  const overlayPlugins = useMemo(() => [plugin], [plugin]);
  useSimulatedPresenceDriver(rows, setPresenceHighlights);

  return (
    <div className="w-full flex h-[420px] flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Click a header to sort: Ada's and Grace's highlights are fixed to view positions and jump
        around, but Linus's highlight is tied to his row id and keeps following the same row.
      </p>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DataGridProvider
          defaultData={rows}
          columns={columns}
          getRowId={(row) => row.id}
          overlayPlugins={overlayPlugins}
          headerClickBehavior="sort"
        >
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
