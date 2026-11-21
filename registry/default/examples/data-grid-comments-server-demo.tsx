"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { useDataGridComments, type CellComment, type CommentAuthor, type CommentSaveCtx } from "@/registry/default/blocks/data-grid-comments/data-grid-comments";
import { createCommentsServer } from "./data-grid-comments-demo-server";
import { generateDemoRows, type DemoRow } from "./demo-data";

const columns = defineColumns<DemoRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 85, flex: 1 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 100, flex: 2 },
  { id: "role", header: "Role", accessorKey: "role", type: "text", width: 65, flex: 1 },
  { id: "score", header: "Logins (30 days)", accessorKey: "score", type: "number", width: 130, flex: 1 },
] as const);

const ME: CommentAuthor = { id: "ada", name: "Ada", color: "oklch(0.7 0.17 60)" };
const PEER: CommentAuthor = { id: "grace", name: "Grace", color: "oklch(0.55 0.2 260)" };
const LATENCY_MS = 400;

const SEED_TIME = Date.UTC(2026, 0, 5, 10, 0);

function peerComment(id: string, rowId: string, columnId: string, text: string, version = 1, now = SEED_TIME): CellComment {
  return { id, rowId, columnId, text, author: PEER, createdAt: now, updatedAt: now, version, writeId: `peer-${id}-${version}`, resolved: false };
}

/** A second user and an in-memory server stand in for the app's own backend and channel. */
function useSimulatedBackend() {
  const rows = useMemo(() => generateDemoRows(24), []);
  const server = useMemo(() => {
    const created = createCommentsServer({ mode: "cas" });
    created.seed([peerComment("seed-1", rows[1]?.id ?? "r1", "name", "Is this the right spelling?"), peerComment("seed-2", rows[4]?.id ?? "r4", "score", "Please double-check this login count.")]);
    return created;
  }, [rows]);
  return { rows, server };
}

export default function DataGridCommentsServerDemo() {
  const { rows, server } = useSimulatedBackend();
  const [offline, setOffline] = useState(false);
  const [log, setLog] = useState("Open a cell and press Shift+F2, or right-click and choose Comments…");
  const seed = useMemo(() => Array.from(server.records.values()), [server]);
  const [timers] = useState(() => new Set<ReturnType<typeof setTimeout>>());
  const [peerCount, setPeerCount] = useState(0);

  useEffect(() => () => timers.forEach(clearTimeout), [timers]);

  const later = (fn: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, LATENCY_MS);
    timers.add(timer);
  };

  const comments = useDataGridComments({
    currentUser: ME,
    defaultComments: seed,
    onCommentSave: async ({ change }: CommentSaveCtx) => {
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      if (offline) throw new Error("offline");
      return server.apply(change).ack;
    },
    onCommentRejected: ({ reason, message }) => setLog(`Write reverted: ${reason}${message ? ` (${message})` : ""}`),
    onLocalChange: (change) => setLog(`Saved ${change.kind === "upsert" ? "comment" : "delete"} at version ${change.kind === "upsert" ? change.comment.version : change.version}`),
  });

  const peerAdds = (): void => {
    const target = rows[(peerCount * 3 + 2) % rows.length];
    if (!target) return;
    const record = peerComment(`peer-${peerCount}`, target.id, columns[peerCount % columns.length]?.id ?? "name", "Peer comment: please review.", 1, Date.now());
    const result = server.apply({ kind: "upsert", comment: record, baseVersion: 0 });
    setPeerCount((n) => n + 1);
    later(() => {
      if (result.broadcast) comments.applyRemote([result.broadcast]);
    });
  };

  const forceConflict = (): void => {
    const first = Array.from(server.records.values()).find((c) => c.author?.id === ME.id) ?? server.records.get("seed-1");
    if (!first) return;
    const edited = { ...first, text: `${first.text} (peer edit)`, version: first.version + 1, updatedAt: Date.now(), writeId: `peer-edit-${first.version + 1}` };
    server.apply({ kind: "upsert", comment: edited, baseVersion: first.version });
    setLog("Grace edited a comment on the server. Edit that comment now to see the conflict.");
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={peerAdds}>
          Grace adds a comment
        </Button>
        <Button variant="outline" size="sm" onClick={forceConflict}>
          Grace edits a comment (force a conflict)
        </Button>
        <Button variant={offline ? "default" : "outline"} size="sm" aria-pressed={offline} onClick={() => setOffline((v) => !v)}>
          {offline ? "Offline: saves fail" : "Go offline"}
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {log}
      </p>
      <div className="flex h-[400px] flex-col overflow-hidden rounded-md border border-border">
        <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} plugins={[comments.plugin]}>
          <DataGridContextMenu className="flex min-h-0 flex-1 flex-col" getCellMenuItems={comments.getCommentMenuItems}>
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
