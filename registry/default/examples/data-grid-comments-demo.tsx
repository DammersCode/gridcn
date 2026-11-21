"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { useDataGridComments, type CellComment } from "@/registry/default/blocks/data-grid-comments/data-grid-comments";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 85, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 100, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 65, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 55, flex: 1 },
] as const);

const STORAGE_KEY = "gridcn-comments-demo";

function loadComments(): CellComment[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as CellComment[]) : [];
  } catch {
    return [];
  }
}

function saveComments(comments: readonly CellComment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch {
    // storage is full or blocked; the comments stay in memory
  }
}

export default function DataGridCommentsDemo() {
  const rows = useMemo(() => generateDemoRows(24), []);
  const [comments, setComments] = useState<readonly CellComment[]>([]);

  useEffect(() => setComments(loadComments()), []);

  const commentsApi = useDataGridComments({
    comments,
    maxComments: 200,
    onCommentsChange: (next) => {
      setComments(next);
      saveComments(next);
    },
  });

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">Open a cell and press Shift+F2, or right-click and choose Comments…. Comments stay in this browser.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setComments([]);
            saveComments([]);
          }}
        >
          Clear comments
        </Button>
      </div>
      <div className="flex h-[400px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} plugins={[commentsApi.plugin]}>
          <DataGridContextMenu className="flex min-h-0 flex-1 flex-col" getCellMenuItems={commentsApi.getCommentMenuItems}>
            <DataGridRoot className="min-h-0 flex-1 rounded-none border-none">
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridContextMenu>
        </DataGridProvider>
      </div>
    </div>
  );
}
