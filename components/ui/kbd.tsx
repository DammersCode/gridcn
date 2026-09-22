import { cn } from "@/lib/utils"

/** Keycap treatment, owned by the component (not the prose typography plugin) so docs, the keybindings dialog, and consumer apps render identically. */
const KEYCAP =
  "rounded-sm border bg-muted shadow-[inset_0_-2px_0_0_color-mix(in_oklab,_currentColor_15%,_transparent)]"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        // `not-prose`: the typography plugin's kbd rule (unlayered) would otherwise restyle component-owned keys
        "pointer-events-none not-prose inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 px-1 font-sans text-xs font-medium text-muted-foreground",
        KEYCAP,
        "in-data-[slot=kbd-group]:min-w-0 in-data-[slot=kbd-group]:border-0 in-data-[slot=kbd-group]:bg-transparent in-data-[slot=kbd-group]:px-0.5 in-data-[slot=kbd-group]:shadow-none",
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
        "[&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

/** One keycap for a whole binding; inner `Kbd` chips flatten via `in-data-[slot=kbd-group]` and stay separated by the gap. */
function KbdGroup({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="kbd-group"
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 px-1 font-sans text-xs font-medium text-muted-foreground",
        KEYCAP,
        className
      )}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
