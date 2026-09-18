import type { ReactNode, SVGProps } from "react";

/**
 * The brand mark: a grid split on the diagonal, one half solid and one half held back —
 * a table and a movement at once. Inherits `currentColor`, so it needs no per-theme variant.
 */
export function Logo(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2.5 12h19M12 2.5v19" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2.5h9.5v9.5z" fill="currentColor" />
      <path d="M2.5 12h9.5v9.5z" fill="currentColor" opacity="0.35" />
    </svg>
  );
}
