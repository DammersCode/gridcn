"use client";

/*
 * The FpsMeter below is adapted from diceui (https://diceui.com), MIT License.
 * Copyright (c) 2024 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const ROW_COUNT = 100_000;

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 90 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 90 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    options: {
      choices: [
        "Admin",
        "User",
        "Editor",
        "Viewer",
        "Manager",
      ],
    },
    width: 130,
  },
  { id: "joined", header: "Joined", accessorKey: "joined", type: "date", width: 140 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 90 },
] as const);

/** rAF-loop FPS readout. */
function FpsMeter(): ReactNode {
  // update interval is 500ms, not per-frame, so this state write is ~2/s regardless of grid fps
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number;

    function tick() {
      const now = performance.now();
      frameCount += 1;
      const delta = now - lastTime;

      if (delta >= 500) {
        setFps(Math.round((frameCount * 1000) / delta));
        frameCount = 0;
        lastTime = now;
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const status = fps < 20 ? "text-destructive" : fps < 30 ? "text-warning" : "text-primary";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-sm border border-border bg-background/80 px-2 py-1 font-mono text-xs backdrop-blur-sm"
    >
      <span className="text-muted-foreground">FPS:</span>
      <span className={status}>{fps}</span>
    </div>
  );
}

/**
 * Same 100k-row dataset as data-grid-large-data-demo, with an FPS meter overlaid top-left so the
 * claim in the performance docs is checkable, not just asserted — scroll and watch the counter.
 */
export default function DataGridPerformanceDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(ROW_COUNT), []);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Scroll through the 100,000 rows and watch the FPS counter (top-left) — only the visible rows are
        ever mounted.
      </p>
      <div className="relative h-[420px] overflow-hidden rounded-md border border-border">
        <FpsMeter />
        <DataGridProvider defaultData={rows} columns={columns} rowMarkers="number">
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
