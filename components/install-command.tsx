"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Check, Copy } from "lucide-react";
import { PACKAGE_MANAGERS, RUNNERS, usePackageManager, type PackageManager } from "@/lib/package-manager";
import { DocsTabs, type DocsTabItem } from "@/components/docs-tabs";

// Client component — keep the address literal here (lib/read-registry-item uses node:fs).
const GRIDCN_REGISTRY = "DammersCode/gridcn";

type InstallCommandProps = {
  /** Registry item name, e.g. "data-grid" — rendered as `<runner> shadcn@latest add <owner>/<repo>/<item>`. */
  item: string;
  /** Render a Command | Manual tab pair; `manualSlot` fills the Manual panel. */
  manual?: boolean;
  /** The Manual tab panel content (a server-rendered `<ManualInstall>` subtree). Ignored unless `manual` is set. */
  manualSlot?: ReactNode;
};

const MANUAL_TABS: readonly DocsTabItem[] = [
  { value: "cli", label: "Command" },
  { value: "manual", label: "Manual" },
];

/** Package-manager-tabbed install command (diceui pattern): persisted choice, synced across all instances, copy button. */
export function InstallCommand({ item, manual = false, manualSlot }: InstallCommandProps): ReactNode {
  const [manager, setManager] = usePackageManager();
  const [copied, setCopied] = useState(false);
  const command = `${RUNNERS[manager]} shadcn@latest add ${GRIDCN_REGISTRY}/${item}`;

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const copyButton = (
    <button
      type="button"
      aria-label="Copy install command"
      onClick={copy}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );

  const pmTabs = (
    <DocsTabs
      tabs={PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm }))}
      value={manager}
      onValueChange={(value) => setManager(value as PackageManager)}
      className={manual ? "border-0 rounded-none" : "my-4"}
      headerClassName="justify-between px-2.5 py-1"
      tabClassName="px-2.5"
      headerEnd={copyButton}
    >
      <pre className="overflow-x-auto px-4 py-3 font-mono text-sm text-foreground">{command}</pre>
    </DocsTabs>
  );

  if (!manual) {
    return pmTabs;
  }

  return (
    <DocsTabs tabs={MANUAL_TABS} defaultValue="cli" className="my-4">
      <Tabs.Panel value="cli">{pmTabs}</Tabs.Panel>
      <Tabs.Panel value="manual" className="p-4">
        {manualSlot}
      </Tabs.Panel>
    </DocsTabs>
  );
}
