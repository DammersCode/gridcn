import type { Root, Node, Folder } from 'fumadocs-core/page-tree';

export type StepPosition = { step: number; total: number };

function pageUrls(folder: Folder): string[] {
  return folder.children.flatMap((child) => (child.type === 'page' ? [child.url] : []));
}

function findFolder(nodes: readonly Node[], url: string): Folder | undefined {
  for (const node of nodes) {
    if (node.type !== 'folder') continue;
    if (pageUrls(node).includes(url)) return node;
    const nested = findFolder(node.children, url);
    if (nested) return nested;
  }
  return undefined;
}

/** Position of a page among the pages of its folder, in `meta.json` order; `undefined` for a page outside a folder. */
export function getStepPosition(tree: Root, url: string): StepPosition | undefined {
  const folder = findFolder(tree.children, url);
  if (!folder) return undefined;
  const urls = pageUrls(folder);
  return { step: urls.indexOf(url) + 1, total: urls.length };
}
