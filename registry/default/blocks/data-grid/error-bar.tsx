"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** The error bar unmounts with a focused control inside it; focus moves to the grid unless the user moved it elsewhere. */
export function ErrorBar({ focusGrid, className, style, children }: { focusGrid: () => void; className: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(focusGrid);
  useLayoutEffect(() => {
    latest.current = focusGrid;
  });
  useLayoutEffect(
    () => () => {
      if (ref.current !== null && ref.current.contains(document.activeElement)) latest.current();
    },
    [],
  );
  return (
    <div ref={ref} data-grid-error-state="" role="alert" className={className} style={style}>
      {children}
    </div>
  );
}
