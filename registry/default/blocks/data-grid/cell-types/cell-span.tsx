/** Shared display span: truncates, and inherits the text alignment of its cell. */
export function CellSpan({ text }: { text: string }) {
  return (
    <span className="block w-full truncate">
      {/* <bdi> isolates the value's own bidi run so mixed-script data shapes correctly, without the
          box taking that run's direction — `dir="auto"` here would resolve a Latin value to `ltr`
          and re-resolve this span's `text-align: start` to the physical LEFT, stranding cell text
          on the wrong side of an RTL grid while the header mirrored correctly. */}
      <bdi>{text}</bdi>
    </span>
  );
}
