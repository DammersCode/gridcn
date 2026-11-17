import type { CellComment, CommentChange, CommentSaveAck } from "@/registry/default/blocks/data-grid-comments/data-grid-comments";

/** How the in-memory server treats a write: `cas` accepts it only when its `baseVersion` equals the stored version, `lww` accepts every write. */
export type CommentsServerMode = "cas" | "lww";

export type CommentsServerOptions = {
  mode?: CommentsServerMode;
  /** Stamp `updatedAt` and return the authoritative record on every accepted write. */
  stamp?: boolean;
  now?: () => number;
};

export type CommentsServerResult = {
  ack: CommentSaveAck | undefined;
  /** The change to broadcast to the other clients, when the write was accepted. */
  broadcast?: CommentChange;
};

/** A compare-and-swap comments store for the demo and the model test. It plays the app's own backend. */
export type CommentsServer = {
  readonly records: ReadonlyMap<string, CellComment>;
  apply(change: CommentChange): CommentsServerResult;
  list(rowIds: readonly string[]): CellComment[];
  seed(records: readonly CellComment[]): void;
};

export function createCommentsServer(options: CommentsServerOptions = {}): CommentsServer {
  const mode = options.mode ?? "cas";
  const now = options.now ?? (() => Date.now());
  const records = new Map<string, CellComment>();
  const deleted = new Map<string, number>();

  const storedVersion = (id: string): number => records.get(id)?.version ?? deleted.get(id) ?? 0;

  return {
    records,
    seed(list) {
      for (const record of list) records.set(record.id, record);
    },
    list(rowIds) {
      const wanted = new Set(rowIds);
      return [...records.values()].filter((record) => wanted.has(record.rowId));
    },
    apply(change) {
      const id = change.kind === "upsert" ? change.comment.id : change.id;
      const current = records.get(id);
      const base = change.baseVersion ?? 0;
      if (change.kind === "upsert" && current && change.comment.writeId !== undefined && current.writeId === change.comment.writeId) {
        return { ack: options.stamp ? { comment: current } : undefined };
      }
      if (mode === "cas" && base !== storedVersion(id)) {
        return { ack: { rejected: { reason: "stale", current: current ?? null } } };
      }
      if (change.kind === "delete") {
        const version = mode === "cas" ? change.version : Math.max(change.version, storedVersion(id) + 1);
        records.delete(id);
        deleted.set(id, version);
        const differs = version !== change.version;
        return { ack: options.stamp || differs ? { comment: null } : undefined, broadcast: { ...change, version } };
      }
      const version = mode === "cas" ? change.comment.version : Math.max(change.comment.version, storedVersion(id) + 1);
      const stamped: CellComment = { ...change.comment, version, updatedAt: options.stamp ? now() : change.comment.updatedAt };
      records.set(id, stamped);
      deleted.delete(id);
      const differs = version !== change.comment.version;
      return { ack: options.stamp || differs ? { comment: stamped } : undefined, broadcast: { kind: "upsert", comment: stamped } };
    },
  };
}
