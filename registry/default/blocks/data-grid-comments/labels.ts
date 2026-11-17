import { mergeLabelLayers } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Every string of the comments UI. Functions take the values to insert; the plural form is the function's job. */
export type DataGridCommentsLabels = {
  popover: (columnTitle: string, cellText: string) => string;
  /** Locale of the comment times. Pinned so the server and the client render the same text. */
  locale: string;
  commentList: string;
  composer: string;
  editComposer: string;
  composerPlaceholder: string;
  submit: string;
  cancel: string;
  save: string;
  editAction: string;
  deleteAction: string;
  confirmDeleteAction: string;
  resolveAction: string;
  reopenAction: string;
  /** `name` is `""` for a comment without an author. */
  edit: (name: string, time: string) => string;
  remove: (name: string, time: string) => string;
  confirmRemove: (name: string, time: string) => string;
  resolve: (name: string, time: string) => string;
  reopen: (name: string, time: string) => string;
  resolved: string;
  saving: string;
  loading: string;
  loadFailed: string;
  retry: string;
  discard: string;
  saveMine: string;
  changedByOther: string;
  readOnlyHint: string;
  rowBusyHint: string;
  refused: string;
  failed: string;
  counter: (used: number, max: number) => string;
  menuItem: string;
  noComments: string;
  /** `chord` is `""` when the app unbinds `openComments`. */
  announce: (count: number, unresolved: number, chord: string) => string;
  /** The announcement when `enableResolve` is `false`. */
  announceCount: (count: number, chord: string) => string;
  /** `name` is `""` for a comment without an author. */
  announceAdded: (name: string) => string;
  unknownAuthor: string;
};

const by = (name: string): string => (name ? ` by ${name}` : "");
const openHint = (chord: string): string => (chord ? ` Press ${chord} to open.` : "");

export const DEFAULT_COMMENTS_LABELS: DataGridCommentsLabels = {
  popover: (columnTitle, cellText) => (cellText ? `Comments on ${columnTitle}: ${cellText}` : `Comments on ${columnTitle}`),
  locale: "en-US",
  commentList: "Comments",
  composer: "Write a comment",
  editComposer: "Edit comment",
  composerPlaceholder: "Write a comment…",
  submit: "Comment",
  cancel: "Cancel",
  save: "Save",
  editAction: "Edit",
  deleteAction: "Delete",
  confirmDeleteAction: "Delete?",
  resolveAction: "Resolve",
  reopenAction: "Reopen",
  edit: (name, time) => `Edit comment${by(name)}, ${time}`,
  remove: (name, time) => `Delete comment${by(name)}, ${time}`,
  confirmRemove: (name, time) => `Confirm delete of comment${by(name)}, ${time}`,
  resolve: (name, time) => `Resolve comment${by(name)}, ${time}`,
  reopen: (name, time) => `Reopen comment${by(name)}, ${time}`,
  resolved: "Resolved",
  saving: "Saving",
  loading: "Loading comments…",
  loadFailed: "Could not load comments",
  retry: "Retry",
  discard: "Discard",
  saveMine: "Save my version",
  changedByOther: "Changed by someone else",
  readOnlyHint: "Comments are read-only.",
  rowBusyHint: "This row is still saving. Try again in a moment.",
  refused: "You cannot do this.",
  failed: "The comment could not be saved.",
  counter: (used, max) => `${used} / ${max}`,
  menuItem: "Comments…",
  noComments: "No comments yet.",
  announce: (count, unresolved, chord) => `${count} ${count === 1 ? "comment" : "comments"}, ${unresolved} unresolved.${openHint(chord)}`,
  announceCount: (count, chord) => `${count} ${count === 1 ? "comment" : "comments"}.${openHint(chord)}`,
  announceAdded: (name) => (name ? `Comment added by ${name}` : "Comment added"),
  unknownAuthor: "Unknown",
};

/** The default labels under `overrides`; a key set to `undefined` keeps its default. */
export function resolveCommentsLabels(overrides: Partial<DataGridCommentsLabels> | undefined): DataGridCommentsLabels {
  return mergeLabelLayers<DataGridCommentsLabels>(DEFAULT_COMMENTS_LABELS, overrides);
}
