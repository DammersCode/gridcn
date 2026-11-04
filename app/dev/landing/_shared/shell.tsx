import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";
import { baseOptions } from "@/lib/layout.shared";

export function DraftShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="relative flex flex-1 flex-col items-center">
        <div className="fixed bottom-2 end-2 z-50 border bg-card px-2 py-1 text-xs text-muted-foreground">
          Draft {name} (dev only)
        </div>
        {children}
      </div>
    </HomeLayout>
  );
}
