import { HeroShader } from "@/components/hero-shader";
import { cn } from "@/lib/utils";

/** Pushes the animated grid back: blur plus a theme-colored wash keeps it recognizable behind text. */
export function BackdropVeil({ className, layers = [] }: { className?: string; layers?: string[] }) {
  return (
    <>
      <HeroShader />
      {[className, ...layers].map((layer, i) => (
        <div key={i} aria-hidden="true" className={cn("pointer-events-none fixed inset-0 z-[1]", layer)} />
      ))}
    </>
  );
}
