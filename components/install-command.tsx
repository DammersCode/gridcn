"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Check, Copy } from "lucide-react";
import { PACKAGE_MANAGERS, RUNNERS, usePackageManager, type PackageManager } from "@/lib/package-manager";
import type { RegistryItemName } from "@/lib/registry-items";
import { DocsTabs, type DocsTabItem } from "@/components/docs-tabs";
import { Checkbox } from "@/components/ui/checkbox";

// Client component — keep the addresses literal here (lib/read-registry-item uses node:fs).
const GRIDCN_REGISTRY = "@gridcn";

export type InstallPickerItem = {
  /** Registry item name, e.g. "data-grid-toolbar" — rendered as `@gridcn/<name>` in the command. */
  value: RegistryItemName;
  /** Display label in the picker; defaults to the item name. */
  label?: string;
  /** Checked on mount. Defaults to false. */
  defaultChecked?: boolean;
};

type InstallCommandProps = {
  /** Registry item name, e.g. "data-grid" — rendered as `<runner> shadcn@latest add @gridcn/<item>`. */
  item?: RegistryItemName;
  /** Picker mode: the command joins the checked items in `items` order. */
  items?: InstallPickerItem[];
  /** A full command after the runner, e.g. "shadcn add DammersCode/gridcn/data-grid#v1.0.0" — wins over `item` and `items`. */
  command?: string;
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
export function InstallCommand({ item, items, command, manual = false, manualSlot }: InstallCommandProps): ReactNode {
  const [manager, setManager] = usePackageManager();
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState(() => new Set((items ?? []).filter((i) => i.defaultChecked).map((i) => i.value)));

  const target =
    command ??
    (item
      ? `${GRIDCN_REGISTRY}/${item}`
      : (items ?? [])
          .filter((i) => selected.has(i.value))
          .map((i) => `${GRIDCN_REGISTRY}/${i.value}`)
          .join(" "));
  const full = target ? `${RUNNERS[manager]} ${target}` : "";

  const copy = () => {
    if (!full) return;
    void navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const copyButton = (
    <button
      type="button"
      aria-label="Copy install command"
      disabled={!full}
      onClick={copy}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );

  const picker = items ? (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border px-3 py-2.5 sm:grid-cols-3">
      {items.map((i) => (
        <label key={i.value} className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground">
          <Checkbox
            aria-label={i.label ?? i.value}
            checked={selected.has(i.value)}
            onCheckedChange={(checked) => {
              const next = new Set(selected);
              if (checked) next.add(i.value);
              else next.delete(i.value);
              setSelected(next);
            }}
          />
          {i.label ?? i.value}
        </label>
      ))}
    </div>
  ) : null;

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
      <pre className="overflow-x-auto px-4 py-3 font-mono text-sm text-foreground">{full || "Select at least one item"}</pre>
      {picker}
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
