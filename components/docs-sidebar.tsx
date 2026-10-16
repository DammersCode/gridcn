"use client";

import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";
import { usePathname } from "fumadocs-core/framework";
import { useTreePath } from "fumadocs-ui/contexts/tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem,
  useFolderDepth,
} from "fumadocs-ui/components/sidebar/base";

const ROW = "relative flex flex-row items-center text-start text-muted-foreground data-[active=true]:text-primary [&_svg]:size-4 [&_svg]:shrink-0";

const isActive = (url: string, pathname: string) => url.replace(/(.)\/$/, "$1") === pathname.replace(/(.)\/$/, "$1");

function Gutters({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => <span key={i} className="gutter-cell" />);
}

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "none") return null;
  return (
    <span className="nav-badge">
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${status === "new" ? "bg-status-new" : "bg-status-updated"}`} />
      <span className="sr-only">{status === "new" ? "New" : "Updated"}</span>
    </span>
  );
}

function Content({ icon, name, status }: { icon: ReactNode; name: ReactNode; status?: string }) {
  return (
    <span className="nav-content">
      {icon}
      <span className="nav-title" title={typeof name === "string" ? name : undefined}>
        {name}
      </span>
      <StatusBadge status={status} />
    </span>
  );
}

export function DocsSidebarItem({ item }: { item: PageTree.Item }) {
  const depth = useFolderDepth();
  const pathname = usePathname();
  return (
    <SidebarItem href={item.url} external={item.external} icon={<></>} active={isActive(item.url, pathname)} className={ROW}>
      <Gutters count={depth} />
      <Content icon={item.icon} name={item.name} status={(item as { status?: string }).status} />
      {depth > 0 && <span className="chev-cell" />}
    </SidebarItem>
  );
}

export function DocsSidebarFolder({ item, children }: { item: PageTree.Folder; children: ReactNode }) {
  const pathname = usePathname();
  const path = useTreePath();
  const collapsible = item.collapsible !== false;
  const rowClass = collapsible ? `${ROW} nd-nav-band w-full` : `${ROW} w-full`;
  return (
    <SidebarFolder collapsible={item.collapsible} active={path.includes(item)} defaultOpen={item.defaultOpen}>
      <FolderRow item={item} className={rowClass} active={item.index ? isActive(item.index.url, pathname) : false} />
      <SidebarFolderContent className="relative">
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </SidebarFolderContent>
    </SidebarFolder>
  );
}

function FolderRow({ item, className, active }: { item: PageTree.Folder; className: string; active: boolean }) {
  const depth = useFolderDepth();
  const body = (
    <>
      <Gutters count={depth - 1} />
      <Content icon={item.icon} name={item.name} />
    </>
  );
  if (item.index) {
    return (
      <SidebarFolderLink href={item.index.url} external={item.index.external} active={active} className={className}>
        {body}
      </SidebarFolderLink>
    );
  }
  return <SidebarFolderTrigger className={className}>{body}</SidebarFolderTrigger>;
}
