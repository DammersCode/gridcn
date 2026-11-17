import { useDataGridComments } from "./data-grid-comments";
import type { CellComment, CommentChange, CommentSaveAck } from "./data-grid-comments";

const author = { id: "u1", name: "Ada" };

export function typedComments() {
  return useDataGridComments({
    currentUser: author,
    defaultComments: [],
    onCommentSave: async ({ action, change, prev }): Promise<void | CommentSaveAck> => {
      const kind: CommentChange["kind"] = change.kind;
      const label: "create" | "update" | "delete" | "resolve" | "reopen" = action;
      const version: number | undefined = prev?.version;
      void [kind, label, version];
      return { rejected: { reason: "stale", current: null } };
    },
    onCommentsChange: (next, { changes, source }) => {
      const first: CellComment | undefined = next[0];
      const count: number = changes.length;
      const origin: "ack" | "remote" | "fetch" | "id-swap" | "remove" = source;
      void [first, count, origin];
    },
    canEdit: ({ comment, user, signal }) => comment.author?.id === user?.id && !signal.aborted,
    canResolve: ({ action }) => action === "resolve",
    readOnly: false,
    enableResolve: true,
    fetchComments: async ({ rowIds }) => rowIds.map((rowId) => ({ id: rowId, rowId, columnId: "name", text: "x", author, createdAt: 0, updatedAt: 0, version: 1, resolved: false })),
  });
}

export function controlledComments(comments: readonly CellComment[]) {
  const { applyRemote, openComments } = useDataGridComments({ comments });
  const verdict = applyRemote([]);
  const applied: number = verdict.applied;
  const opened: boolean = openComments({ rowId: "r1", columnId: "name" });
  return [applied, opened];
}

// @ts-expect-error the save callback is not a boolean
useDataGridComments({ onCommentSave: () => true });

export function anonymousComments() {
  return useDataGridComments({ defaultComments: [{ id: "c1", rowId: "r1", columnId: "name", text: "x", createdAt: 0, updatedAt: 0, version: 1, resolved: false }] });
}

export function serverStampedComments() {
  return useDataGridComments({ currentUser: { id: "u1" }, readOnly: true });
}
