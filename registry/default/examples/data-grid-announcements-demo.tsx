"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderFilter } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 110, flex: 1 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 90, flex: 1 },
] as const);

function useSpokenText(): string {
  const [text, setText] = useState("");
  useEffect(() => {
    let regionObserver: MutationObserver | undefined;
    const read = (region: Element) => {
      const spoken = region.textContent?.trim();
      if (spoken) setText(spoken);
    };
    const attach = (): boolean => {
      const region = document.querySelector("[data-grid-live-region]");
      if (!region) return false;
      regionObserver = new MutationObserver(() => read(region));
      regionObserver.observe(region, { childList: true, characterData: true, subtree: true });
      return true;
    };
    const bodyObserver = new MutationObserver(() => attach() && bodyObserver.disconnect());
    if (!attach()) bodyObserver.observe(document.body, { childList: true });
    return () => {
      bodyObserver.disconnect();
      regionObserver?.disconnect();
    };
  }, []);
  return text;
}

export default function DataGridAnnouncementsDemo(): ReactNode {
  const rows = useMemo(() => generateDemoRows(50), []);
  const spoken = useSpokenText();

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="m-0 text-sm text-muted-foreground">
        Check rows with the markers or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>, or filter and sort a column.
        The line below shows the text a screen reader hears from the grid&apos;s live region.
      </p>
      <p className="m-0 min-h-6 rounded-md border px-2 py-1 text-sm" aria-hidden="true">
        Last announcement: <span className="font-medium">{spoken || "none yet"}</span>
      </p>
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} rowMarkers="checkbox" announceResults>
        <DataGridRoot className="h-[360px]" renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
