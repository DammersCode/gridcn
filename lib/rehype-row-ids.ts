export type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Anchor id of the table row whose first cell is `name`: `prop-` plus the lowercased name. */
export const rowIdOf = (name: string): string => `prop-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

const elements = (node: HastNode) => (node.children ?? []).filter((child) => child.type === 'element');

function singleCodeName(cell: HastNode): string | undefined {
  const content = (cell.children ?? []).filter((child) => child.type !== 'text' || child.value?.trim());
  const [only] = content;
  if (content.length !== 1 || only?.tagName !== 'code') return undefined;
  const text = (only.children ?? []).map((child) => child.value ?? '').join('');
  return IDENTIFIER.test(text) ? text : undefined;
}

/** Gives the first table row of each name on a page an id, so a link can point at one prop. */
export function rehypeRowIds() {
  return (tree: HastNode) => {
    const taken = new Set<string>();
    const visit = (node: HastNode) => {
      if (node.tagName === 'tr') {
        const [cell] = elements(node);
        const name = cell?.tagName === 'td' ? singleCodeName(cell) : undefined;
        const id = name && rowIdOf(name);
        if (id && !taken.has(id)) {
          taken.add(id);
          node.properties = { ...node.properties, id };
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
