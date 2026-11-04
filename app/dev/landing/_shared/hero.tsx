import Link from "next/link";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InstallCommand } from "@/components/install-command";
import { gitConfig } from "@/lib/shared";
import { cn } from "@/lib/utils";

function GithubIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.1 3.29 9.4 7.86 10.94.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.09-.12-.29-.52-1.48.11-3.08 0 0 .97-.31 3.2 1.18a11 11 0 0 1 5.82 0c2.22-1.49 3.19-1.18 3.19-1.18.64 1.6.24 2.79.12 3.08.75.8 1.2 1.83 1.2 3.09 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.07.78 2.15 0 1.56-.01 2.81-.01 3.19 0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12c0-6.27-5.23-11.5-11.5-11.5Z" />
    </svg>
  );
}

export const TAGLINE =
  "A data grid for the shadcn ecosystem. Range selection, spreadsheet clipboard and typed editors on real DOM cells. Local arrays or a server: the same grid.";

export function HeroActions({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button render={<Link href="/docs" />} nativeButton={false} size="lg">
        Get started
      </Button>
      <Button
        render={<a href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`} target="_blank" rel="noreferrer" />}
        nativeButton={false}
        variant="outline"
        size="lg"
      >
        <GithubIcon className="size-4" />
        GitHub
      </Button>
    </div>
  );
}

export function ReleaseBadge() {
  return <Badge variant="outline">2.0 · Open source · shadcn registry</Badge>;
}

export function Install({ className }: { className?: string }) {
  return (
    <div className={cn("w-full min-w-0 max-w-md overflow-x-auto text-start", className)}>
      <InstallCommand item="data-grid" />
    </div>
  );
}
