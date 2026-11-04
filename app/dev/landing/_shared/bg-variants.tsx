"use client";

import { useState, type ReactNode } from "react";
import { HeroShader } from "@/components/hero-shader";
import { cn } from "@/lib/utils";

export type BgVariant = {
  id: number;
  name: string;
  kind: "blur" | "effect";
  /** class on the fixed wrapper around the canvas (filter, opacity) */
  canvas?: string;
  /** one class per fixed overlay layer above the canvas */
  layers: string[];
};

const wash = "bg-background";

export const bgVariants: BgVariant[] = [
  { id: 1, name: "Blur, light", kind: "blur", layers: [`${wash}/35 backdrop-blur-[2px]`] },
  { id: 2, name: "Blur, medium", kind: "blur", layers: [`${wash}/55 backdrop-blur-[6px]`] },
  { id: 3, name: "Blur, strong", kind: "blur", layers: [`${wash}/65 backdrop-blur-xl`] },
  {
    id: 4,
    name: "Ghost: gray and faint",
    kind: "effect",
    canvas: "grayscale opacity-30",
    layers: [],
  },
  {
    id: 5,
    name: "Vignette: clear edges, calm center",
    kind: "effect",
    layers: [
      `${wash}/90 [mask-image:radial-gradient(ellipse_60%_70%_at_50%_45%,black_40%,transparent_100%)]`,
      `${wash}/25`,
    ],
  },
  {
    id: 6,
    name: "Fade down: alive on top, solid below",
    kind: "effect",
    layers: ["bg-[linear-gradient(to_bottom,transparent_0,transparent_12%,var(--background)_70%)]"],
  },
  {
    id: 7,
    name: "Low contrast: flattened",
    kind: "effect",
    canvas: "grayscale-[0.6] contrast-[0.5] brightness-[0.9] opacity-60",
    layers: [`${wash}/30`],
  },
  {
    id: 8,
    name: "Side rails: visible in the gutters",
    kind: "effect",
    layers: [
      `${wash} [mask-image:linear-gradient(to_right,transparent,black_14%,black_86%,transparent)]`,
      `${wash}/40`,
    ],
  },
  {
    id: 9,
    name: "Darken on scroll",
    kind: "effect",
    layers: [`${wash} opacity-30 [animation:landing-bg-dim_linear_both] [animation-timeline:scroll()] [animation-range:0_90vh]`],
  },
  {
    id: 10,
    name: "Halftone: dotted screen",
    kind: "effect",
    layers: [
      "[background-image:radial-gradient(var(--background)_58%,transparent_60%)] [background-size:5px_5px]",
      `${wash}/30`,
    ],
  },
];

export function LandingBackground({ variant }: { variant: BgVariant }) {
  return (
    <>
      <style>{`@keyframes landing-bg-dim { to { opacity: 0.92; } }`}</style>
      <div aria-hidden="true" className={cn("pointer-events-none fixed inset-0 z-0", variant.canvas)}>
        <HeroShader />
      </div>
      {variant.layers.map((layer, i) => (
        <div key={i} aria-hidden="true" className={cn("pointer-events-none fixed inset-0 z-[1]", layer)} />
      ))}
    </>
  );
}

export function BgPlayground({ children, initial = 2, switcher = true }: { children: ReactNode; initial?: number; switcher?: boolean }) {
  const [id, setId] = useState(initial);
  const variant = bgVariants.find((v) => v.id === id) ?? bgVariants[0];
  return (
    <>
      <LandingBackground variant={variant} />
      {switcher && <div className="fixed start-2 top-16 z-50 flex max-w-[calc(100vw-1rem)] flex-col gap-1 border bg-card p-2 text-xs shadow-sm" role="radiogroup" aria-label="Background approach">
        <p className="font-medium">Background approach (dev only)</p>
        {bgVariants.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === id}
            onClick={() => setId(v.id)}
            className={cn("flex items-center gap-2 px-2 py-1 text-start", v.id === id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            <span className="w-4 tabular-nums">{v.id}</span>
            <span>{v.name}</span>
          </button>
        ))}
      </div>}
      {children}
    </>
  );
}
