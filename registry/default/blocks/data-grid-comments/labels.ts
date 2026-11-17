import { mergeLabelLayers, type DataGridCommentsLabels } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export type { DataGridCommentsLabels } from "@/registry/default/blocks/data-grid/data-grid-sdk";

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
