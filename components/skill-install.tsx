"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { RUNNERS, usePackageManager } from "@/lib/package-manager";

export function SkillInstall({ skill }: { skill: string }) {
  const [manager] = usePackageManager();
  const [copied, setCopied] = useState(false);
  const full = `${RUNNERS[manager]} skills add DammersCode/gridcn@${skill}`;

  return (
    <button
      type="button"
      title={full}
      aria-label={`Copy install command for ${skill}`}
      onClick={() => {
        void navigator.clipboard.writeText(full).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
