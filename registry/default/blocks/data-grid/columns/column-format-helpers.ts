import { Fragment, isValidElement, type ReactNode } from "react";

const MAX_NODE_DEPTH = 8;
const MAX_NODE_TEXT = 200;

function collectNodeText(node: ReactNode, depth: number, parts: string[]): void {
  if (depth > MAX_NODE_DEPTH) return;
  if (typeof node === "string" || typeof node === "number") {
    parts.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) collectNodeText(child, depth, parts);
  } else if (isValidElement<{ children?: ReactNode }>(node) && (typeof node.type === "string" || node.type === Fragment)) {
    collectNodeText(node.props.children, depth + 1, parts);
  }
}

/** Text of host elements and fragments; a component contributes nothing, so the walk is pure and SSR-stable. */
function nodePlainText(node: ReactNode): string {
  const parts: string[] = [];
  collectNodeText(node, 0, parts);
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, MAX_NODE_TEXT);
}

/** `headerText`, else the string `header`, else the plain text of a node `header`; empty when none. */
export function columnHeaderText(column: { header?: unknown; headerText?: string }): string {
  if (column.headerText !== undefined) return column.headerText;
  return typeof column.header === "string" ? column.header : nodePlainText(column.header as ReactNode);
}

/** Column label for a11y strings: the header text, else the id. */
export function columnLabelText(column: { id: string; header?: unknown; headerText?: string }): string {
  return columnHeaderText(column) || column.id;
}

/** Run-length-encodes consecutive equal widths into `repeat(n, wpx)` grid-template segments. */
export function encodeTemplate(widths: number[]): string {
  const segments: string[] = [];
  let i = 0;
  while (i < widths.length) {
    let j = i + 1;
    while (j < widths.length && widths[j] === widths[i]) j++;
    const count = j - i;
    segments.push(count > 1 ? `repeat(${count}, ${widths[i]}px)` : `${widths[i]}px`);
    i = j;
  }
  return segments.join(" ");
}
