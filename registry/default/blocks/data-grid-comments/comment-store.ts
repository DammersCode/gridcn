import { createStore, type StoreApi } from "zustand/vanilla";
import { reduce } from "./comment-reducer";
import { createCommentsState, type CommentEvent, type CommentsState, type ReduceResult } from "./comment-state";
import type { Bounds } from "./validate";

export type OpenTarget = { rowId: string; columnId: string; by: "keyboard" | "pointer" | "menu"; nonce: number };

/** The numeric channels the UI subscribes to. `revision` moves with comment content, `draftRevision` with drafts and conflicts only. */
export type CommentUiState = {
  revision: number;
  draftRevision: number;
  open: OpenTarget | null;
  announcement: { text: string; nonce: number };
};

export type CommentStore = {
  core: CommentsState;
  ui: StoreApi<CommentUiState>;
  /** Row ids of the rendered, non-hole rows; a plain field so reporting never renders. */
  visibleRowIds: readonly string[];
  setVisibleRowIds(ids: readonly string[]): void;
  onVisibleChange: (() => void) | null;
  dispatch(event: CommentEvent): ReduceResult;
  bumpDrafts(): void;
  bumpContent(): void;
  open(target: { rowId: string; columnId: string }, by: OpenTarget["by"]): void;
  close(): void;
  announce(text: string): void;
};

const QUIET_EVENTS = new Set<CommentEvent["type"]>(["fetchStart", "invalidateRows"]);

export function createCommentStore(bounds: Bounds, controlled: boolean): CommentStore {
  const core = createCommentsState(bounds, controlled);
  const ui = createStore<CommentUiState>(() => ({ revision: 0, draftRevision: 0, open: null, announcement: { text: "", nonce: 0 } }));
  let nonce = 0;
  const store: CommentStore = {
    core,
    ui,
    visibleRowIds: [],
    onVisibleChange: null,
    setVisibleRowIds(ids) {
      store.visibleRowIds = ids;
      store.onVisibleChange?.();
    },
    dispatch(event) {
      const seqBefore = core.seq;
      const result = reduce(core, event);
      const idle = event.type === "propChange" || event.type === "expire" || event.type === "remote";
      if (!QUIET_EVENTS.has(event.type) && (!idle || core.seq !== seqBefore)) ui.setState((s) => ({ revision: s.revision + 1, draftRevision: s.draftRevision + 1 }));
      return result;
    },
    bumpDrafts() {
      ui.setState((s) => ({ draftRevision: s.draftRevision + 1 }));
    },
    bumpContent() {
      ui.setState((s) => ({ revision: s.revision + 1, draftRevision: s.draftRevision + 1 }));
    },
    open(target, by) {
      nonce += 1;
      ui.setState({ open: { rowId: target.rowId, columnId: target.columnId, by, nonce } });
    },
    close() {
      if (ui.getState().open !== null) ui.setState({ open: null });
    },
    announce(text) {
      ui.setState((s) => ({ announcement: { text, nonce: s.announcement.nonce + 1 } }));
    },
  };
  return store;
}
