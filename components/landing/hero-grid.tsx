"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const HeroGridLive = dynamic(() => import("./hero-grid-live"), { ssr: false });

export function HeroGrid(): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="h-60 overflow-hidden rounded-lg border bg-background sm:h-72">
        <HeroGridLive />
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="pointer-coarse:hidden">
          <span className="font-medium text-foreground">Try it:</span> drag the selection handle down. The series continues: 4, 5, 6 and Item 4, Item 5, Item 6. Ctrl+Z (Cmd+Z on Mac) undoes it.
        </span>
        <span className="hidden pointer-coarse:inline">
          <span className="font-medium text-foreground">Try it:</span> tap a cell, then drag a selection handle to select a range. The fill handle needs a mouse.
        </span>
      </p>
    </div>
  );
}
