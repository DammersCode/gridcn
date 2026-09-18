import { cn } from "@/lib/utils";

/**
 * Shared display span: truncates and honors the type's text alignment. `align` names are reading
 * relative, not physical — `"right"` is the END of the reading direction, so a right-aligned
 * numeric column hugs the inline end in both LTR and RTL.
 */
export function CellSpan({ text, align }: { text: string; align?: "left" | "right" | "center" }) {
  return (
    <span
      className={cn(
        "block w-full truncate",
        align === "right" && "text-end",
        align === "center" && "text-center",
      )}
    >
      {/* <bdi> isolates the value's own bidi run so mixed-script data shapes correctly, without the
          box taking that run's direction — `dir="auto"` here would resolve a Latin value to `ltr`
          and re-resolve this span's `text-align: start` to the physical LEFT, stranding cell text
          on the wrong side of an RTL grid while the header mirrored correctly. */}
      <bdi>{text}</bdi>
    </span>
  );
}
