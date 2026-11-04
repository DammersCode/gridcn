"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const Demo = dynamic(() => import("@/registry/default/examples/data-grid-demo"), {
  ssr: false,
  loading: () => <DemoSkeleton />,
});

function DemoSkeleton() {
  return (
    <div className="flex h-full flex-col gap-px bg-border" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className={cn("h-9 bg-card", i === 0 && "bg-muted")} />
      ))}
    </div>
  );
}

/** Mounts the real grid when the box nears the viewport; the box height is reserved by the caller. */
export function LazyHeroDemo({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setMounted(true),
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("overflow-hidden border bg-background shadow-sm", className)}>
      {mounted ? <Demo /> : <DemoSkeleton />}
    </div>
  );
}
