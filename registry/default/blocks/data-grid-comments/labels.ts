/** Every string of the comments UI. Functions take the values to insert; the plural form is the function's job. */
export type DataGridCommentsLabels = {
  popover: (columnTitle: string, cellText: string) => string;
  /** Locale of the comment times. Pinned so the server and the client render the same text. */
  locale: string;
  commentList: string;
  composer: string;
  composerPlaceholder: string;
  submit: string;
  cancel: string;
  save: string;
  editAction: string;
  deleteAction: string;
  confirmDeleteAction: string;
  resolveAction: string;
  reopenAction: string;
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
  noUserHint: string;
  rowBusyHint: string;
  refused: string;
  failed: string;
  counter: (used: number, max: number) => string;
  menuItem: string;
  noComments: string;
  announce: (count: number, unresolved: number, chord: string) => string;
  announceAdded: (name: string) => string;
  unknownAuthor: string;
};

export const DEFAULT_COMMENTS_LABELS: DataGridCommentsLabels = {
  popover: (columnTitle, cellText) => (cellText ? `Comments on ${columnTitle}: ${cellText}` : `Comments on ${columnTitle}`),
  locale: "en-US",
  commentList: "Comments",
  composer: "Write a comment",
  composerPlaceholder: "Write a comment…",
  submit: "Comment",
  cancel: "Cancel",
  save: "Save",
  editAction: "Edit",
  deleteAction: "Delete",
  confirmDeleteAction: "Delete?",
  resolveAction: "Resolve",
  reopenAction: "Reopen",
  edit: (name, time) => `Edit comment by ${name}, ${time}`,
  remove: (name, time) => `Delete comment by ${name}, ${time}`,
  confirmRemove: (name, time) => `Confirm delete of comment by ${name}, ${time}`,
  resolve: (name, time) => `Resolve comment by ${name}, ${time}`,
  reopen: (name, time) => `Reopen comment by ${name}, ${time}`,
  resolved: "Resolved",
  saving: "Saving",
  loading: "Loading comments…",
  loadFailed: "Could not load comments",
  retry: "Retry",
  discard: "Discard",
  saveMine: "Save my version",
  changedByOther: "Changed by someone else",
  readOnlyHint: "Comments are read-only.",
  noUserHint: "Sign in to comment.",
  rowBusyHint: "This row is still saving. Try again in a moment.",
  refused: "You cannot do this.",
  failed: "The comment could not be saved.",
  counter: (used, max) => `${used} / ${max}`,
  menuItem: "Comments…",
  noComments: "No comments yet.",
  announce: (count, unresolved, chord) => `${count} ${count === 1 ? "comment" : "comments"}, ${unresolved} unresolved. Press ${chord} to open.`,
  announceAdded: (name) => `Comment added by ${name}`,
  unknownAuthor: "Unknown",
};
