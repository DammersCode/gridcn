"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { PACKAGE_MANAGERS, usePackageManager, type PackageManager } from "@/lib/package-manager";
import { DocsTabs } from "@/components/docs-tabs";

const INSTALLERS: Record<PackageManager, string> = {
  pnpm: "pnpm add",
  npm: "npm install",
  yarn: "yarn add",
  bun: "bun add",
};

type ManualInstallDepsProps = {
  dependencies: string[];
  devDependencies: string[];
};

/** Package-manager-tabbed `install <deps>` block for the Manual tab's dependencies step — shares the persisted choice from {@link usePackageManager}. */
export function ManualInstallDeps({ dependencies, devDependencies }: ManualInstallDepsProps): ReactNode {
  const [manager, setManager] = usePackageManager();
  const [copied, setCopied] = useState(false);

  const commands = [
    dependencies.length > 0 ? `${INSTALLERS[manager]} ${dependencies.join(" ")}` : null,
    devDependencies.length > 0 ? `${INSTALLERS[manager]} -D ${devDependencies.join(" ")}` : null,
  ].filter((line): line is string => line !== null);
  const command = commands.join("\n");

  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <DocsTabs
      tabs={PACKAGE_MANAGERS.map((pm) => ({ value: pm, label: pm }))}
      value={manager}
      onValueChange={(value) => setManager(value as PackageManager)}
      headerClassName="justify-between px-2.5 py-1"
      tabClassName="px-2.5"
      headerEnd={
        <button
          type="button"
          aria-label="Copy install command"
          onClick={copy}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      }
    >
      <pre className="overflow-x-auto px-4 py-3 font-mono text-sm text-foreground">{command}</pre>
    </DocsTabs>
  );
}
