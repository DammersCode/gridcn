import type * as PageTree from 'fumadocs-core/page-tree';
import type { LayoutTab } from 'fumadocs-ui/layouts/shared';

function firstPageUrl(folder: PageTree.Folder): string | undefined {
  if (folder.index) return folder.index.url;
  for (const child of folder.children) {
    if (child.type === 'page') return child.url;
    if (child.type === 'folder') {
      const url = firstPageUrl(child);
      if (url) return url;
    }
  }
}

/** One tab per `root: true` folder; unlike the stock helper, a folder without a direct page still gets its first nested page as target. */
export function getDocsTabs(tree: PageTree.Root): LayoutTab[] {
  const tabs: LayoutTab[] = [];
  const visit = (node: PageTree.Node) => {
    if (node.type !== 'folder') return;
    if (node.root) {
      const url = firstPageUrl(node);
      if (url) tabs.push({ title: node.name, icon: node.icon, description: node.description, url, $folder: node });
    }
    node.children.forEach(visit);
  };
  tree.children.forEach(visit);
  return tabs;
}
