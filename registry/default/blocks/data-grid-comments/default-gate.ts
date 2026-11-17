import type { CellComment, CommentAuthor } from "./types";

/** The default `canEdit` and `canDelete`: anyone on a comment with no author, otherwise the author. */
export function defaultCanModify(comment: CellComment, user: CommentAuthor | undefined): boolean {
  return comment.author === undefined || comment.author.id === user?.id;
}

/** An author may be added once to a comment that has none; any other change is invalid. */
export function authorChangeAllowed(current: CommentAuthor | undefined, next: CommentAuthor | undefined): boolean {
  if (current === undefined) return true;
  return next !== undefined && next.id === current.id;
}

/** The name a label or announcement shows: empty for an anonymous comment. */
export function authorLabelName(author: CommentAuthor | undefined, unknownAuthor: string): string {
  return author === undefined ? "" : (author.name ?? unknownAuthor);
}
