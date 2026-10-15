"use client";

import { Copy } from "lucide-react";
import { CopyAnnouncer, CopyIcon, useCopyText } from "@/components/copy-status";
import { RUNNERS, usePackageManager } from "@/lib/package-manager";

export function SkillInstall({ skill }: { skill: string }) {
  const [manager] = usePackageManager();
  const { status, copy } = useCopyText();
  const full = `${RUNNERS[manager]} skills add DammersCode/gridcn@${skill}`;

  return (
    <>
      <button
        type="button"
        title={full}
        aria-label={`Copy install command for ${skill}`}
        onClick={() => void copy(full)}
        className="flex mx-auto size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CopyIcon status={status} idle={<Copy className="size-3.5" />} className="size-3.5" />
      </button>
      <CopyAnnouncer status={status} />
    </>
  );
}
