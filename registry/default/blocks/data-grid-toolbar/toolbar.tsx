import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Props for {@link DataGridToolbar}. */
export type DataGridToolbarProps = {
  className?: string;
  children?: ReactNode;
};

/**
 * Flex frame for the grid's toolbar slots (search, filter menu, columns menu, custom buttons).
 * Consumers place it above `<DataGridRoot>`, inside the same `<DataGridProvider>`, so its children
 * share the grid's store.
 */
export function DataGridToolbar(props: DataGridToolbarProps): ReactNode {
  const { className, children } = props;
  return (
    <div
      data-grid-toolbar=""
      className={cn("flex items-center gap-2 border-b border-border bg-background px-2 py-1.5", className)}
    >
      {children}
    </div>
  );
}
