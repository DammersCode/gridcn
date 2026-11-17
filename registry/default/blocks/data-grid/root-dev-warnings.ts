import { useEffect, useRef } from "react";
import { isDev } from "./is-dev";

export function useUnnamedGridWarning(ariaLabel: string | undefined, ariaLabelledBy: string | undefined): void {
  const warned = useRef(false);
  useEffect(() => {
    if (!isDev() || warned.current || ariaLabel || ariaLabelledBy) return;
    warned.current = true;
    console.warn("[data-grid] The grid has no accessible name. Set aria-label or aria-labelledby on the grid.");
  }, [ariaLabel, ariaLabelledBy]);
}

export function useSecondRootWarning(): (storeHasRoot: boolean) => void {
  const warned = useRef(false);
  return (storeHasRoot) => {
    if (!isDev() || !storeHasRoot || warned.current) return;
    warned.current = true;
    console.warn("[data-grid] a second DataGridRoot mounted on a store that another root already serves; the last mount takes the keyboard, scroll, and focus commands. Give each grid its own store.");
  };
}
