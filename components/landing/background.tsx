"use client";

import dynamic from "next/dynamic";

const HeroShader = dynamic(() => import("@/components/hero-shader").then((m) => m.HeroShader), { ssr: false });

/** Animated grid behind the page, grayed and faded so the solid panels carry the reading. */
export function LandingBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 grayscale opacity-40 dark:opacity-30">
      <HeroShader />
    </div>
  );
}
