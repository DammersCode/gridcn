import type { ReactNode } from "react";
import Link from "next/link";
import { FileIcon, FolderIcon, FolderOpen } from "lucide-react";
import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Files } from "fumadocs-ui/components/files";
import { GRIDCN_REGISTRY, readRegistryItem } from "@/lib/read-registry-item";
import { CodeCollapsible } from "@/components/code-collapsible";
import { DOCS_LINK } from "@/components/docs-tabs";
import { cn } from "@/lib/utils";
import { ManualInstallDeps } from "@/components/manual-install-deps";
import { gitConfig } from "@/lib/shared";

type ManualInstallProps = {
  /** Registry item name, e.g. "data-grid-fill". */
  item: string;
  /** Render a file tree instead of per-file collapsed code blocks — for items too large to copy-paste (the core). */
  tree?: boolean;
};

function langFromTarget(target: string): string {
  return target.endsWith(".tsx") ? "tsx" : "ts";
}

const GITHUB_BASE = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
// fumadocs-ui's File/Folder rows render plain divs without href support — same row look, as anchors.
const ITEM_ROW = "flex flex-row items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fd-accent hover:text-fd-accent-foreground [&_svg]:size-4";

/** One `<Folder>`/`<File>` level of a target-path tree, folders before files, both alphabetical. `path` is the file's GitHub source path from the payload. */
type TreeNode = { folders: Map<string, TreeNode>; files: { name: string; path: string }[] };

function buildTree(files: { target: string; path: string }[]): TreeNode {
  const root: TreeNode = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.target.split("/").slice(1); // drop the leading "components" segment
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part);
      if (!child) {
        child = { folders: new Map(), files: [] };
        node.folders.set(part, child);
      }
      node = child;
    }
    const fileName = parts[parts.length - 1];
    if (fileName) node.files.push({ name: fileName, path: file.path });
  }
  return root;
}

/** Longest common directory of a set of GitHub source paths — the folder page those files live under. */
function sourceFolder(paths: string[]): string {
  const dirs = paths.map((path) => path.split("/").slice(0, -1));
  const root = dirs[0]!;
  let common = root.length;
  for (const dir of dirs) {
    let i = 0;
    while (i < common && i < dir.length && dir[i] === root[i]) i++;
    common = i;
  }
  return root.slice(0, common).join("/");
}

function folderSourcePaths(node: TreeNode): string[] {
  const paths = node.files.map((file) => file.path);
  for (const child of node.folders.values()) paths.push(...folderSourcePaths(child));
  return paths;
}

// Native <details>: this file is a server component, so a JS toggle (useState) would not be interactive.
function FolderRow({ name, href, depth, children }: { name: string; href: string; depth: number; children: ReactNode }): ReactNode {
  return (
    <details className="group" open={depth === 0}>
      <summary className={`${ITEM_ROW} w-full cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden`}>
        <FolderIcon className="group-open:hidden" />
        <FolderOpen className="hidden group-open:block" />
        <a href={href} target="_blank" rel="noreferrer" className={DOCS_LINK}>
          {name}
        </a>
      </summary>
      <div className="ms-2 flex flex-col border-l ps-2">{children}</div>
    </details>
  );
}

function renderTree(node: TreeNode, depth = 0): ReactNode[] {
  const folders = [...node.folders.entries()].sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...folders.map(([name, child]) => (
      <FolderRow key={name} name={name} href={`${GITHUB_BASE}/tree/${gitConfig.branch}/${sourceFolder(folderSourcePaths(child))}`} depth={depth}>
        {renderTree(child, depth + 1)}
      </FolderRow>
    )),
    ...files.map((file) => (
      <a key={file.name} href={`${GITHUB_BASE}/blob/${gitConfig.branch}/${file.path}`} target="_blank" rel="noreferrer" className={cn(ITEM_ROW, DOCS_LINK)}>
        <FileIcon />
        {file.name}
      </a>
    )),
  ];
}

/** Manual-tab body for a docs page: prerequisites, npm deps, the source files (per-file collapsed code, or a `<Files>` tree when `tree`), then the import-path note. Reads `public/r/<item>.json`, the same payload the CLI installs from. */
export async function ManualInstall({ item, tree = false }: ManualInstallProps): Promise<ReactNode> {
  const registryItem = readRegistryItem(item);
  const ownPrefix = `${GRIDCN_REGISTRY}/`;
  const gridcnPrereqs = registryItem.registryDependencies.filter((dep) => dep.startsWith(ownPrefix));
  const shadcnPrereqs = registryItem.registryDependencies.filter((dep) => !dep.startsWith(ownPrefix));

  const highlightedFiles = tree
    ? []
    : await Promise.all(
        registryItem.files.map(async (file) => ({
          target: file.target,
          code: file.content,
          highlighted: await highlight(file.content, {
            lang: langFromTarget(file.target),
            components: {
              pre: (props) => (
                <CodeBlock allowCopy={false} {...props}>
                  <Pre>{props.children}</Pre>
                </CodeBlock>
              ),
            },
          }),
        })),
      );

  // Steps/Step ship no vertical rhythm of their own — one rule here controls it for every block type.
  return (
    <div className="[&_.fd-step>*]:my-0 [&_.fd-step>*+*]:mt-3 [&_.fd-step:not(:last-child)]:mb-6">
      <Steps>
        {gridcnPrereqs.length > 0 && (
          <Step>
            <p>
              Requires <Link href="/docs/installation" className={DOCS_LINK}>`{GRIDCN_REGISTRY}/data-grid`</Link> installed first:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/50 px-4 py-3 font-mono text-sm text-foreground">
              {gridcnPrereqs.map((dep) => `npx shadcn add ${dep}`).join("\n")}
            </pre>
          </Step>
        )}
        {(registryItem.dependencies.length > 0 || registryItem.devDependencies.length > 0 || shadcnPrereqs.length > 0) && (
          <Step>
            <p>Install the following dependencies:</p>
            {shadcnPrereqs.length > 0 && (
              <pre className="overflow-x-auto rounded-lg border border-border bg-secondary/50 px-4 py-3 font-mono text-sm text-foreground">
                {shadcnPrereqs.map((dep) => `npx shadcn add ${dep}`).join("\n")}
              </pre>
            )}
            {(registryItem.dependencies.length > 0 || registryItem.devDependencies.length > 0) && (
              <ManualInstallDeps dependencies={registryItem.dependencies} devDependencies={registryItem.devDependencies} />
            )}
          </Step>
        )}
        {tree ? (
          <Step>
            <p>
              Open the{" "}
              <a
                href={`${GITHUB_BASE}/tree/${gitConfig.branch}/${sourceFolder(registryItem.files.map((file) => file.path))}`}
                target="_blank"
                rel="noreferrer"
                className={DOCS_LINK}
              >
                source folder on GitHub
              </a>{" "}
              and copy it into your project's `components/` directory ({registryItem.files.length} files).
            </p>
            <Files>{renderTree(buildTree(registryItem.files))}</Files>
          </Step>
        ) : (
          <Step>
            <p>Copy and paste the following code into your project.</p>
            <div className="flex flex-col gap-4">
              {highlightedFiles.map((file) => (
                <CodeCollapsible key={file.target} title={file.target} code={file.code}>
                  {file.highlighted}
                </CodeCollapsible>
              ))}
            </div>
          </Step>
        )}
        <Step>
          <p>Update the import paths to match your project setup.</p>
        </Step>
      </Steps>
    </div>
  );
}
