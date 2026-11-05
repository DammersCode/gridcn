import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";
import { DocsSidebarFolder, DocsSidebarItem } from "@/components/docs-sidebar";
import { buildTree, loadCandidate } from "../_lib";

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ candidate: string }> }) {
  const { candidate } = await params;
  const c = loadCandidate(candidate);
  if (!c) notFound();
  return (
    <DocsLayout
      tree={buildTree(c)}
      {...baseOptions()}
      githubUrl={undefined}
      themeSwitch={{ enabled: false }}
      sidebar={{ components: { Item: DocsSidebarItem, Folder: DocsSidebarFolder } }}
    >
      {children}
    </DocsLayout>
  );
}
