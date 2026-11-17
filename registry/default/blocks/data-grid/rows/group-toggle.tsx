"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDataGridActions, useDataGridLabels } from "../store";

/** Props for {@link DataGridGroupToggle}. */
export type DataGridGroupToggleProps = {
  groupId: string;
  /** The label that names the group in the accessible name. */
  label: string;
  expanded: boolean;
};

/** The open/close button of a group row. Out of the Tab order: Enter, Space, and the arrow keys on the row are its keyboard path. */
export function DataGridGroupToggle({ groupId, label, expanded }: DataGridGroupToggleProps): ReactNode {
  const actions = useDataGridActions();
  const labels = useDataGridLabels();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      tabIndex={-1}
      data-grid-group-toggle=""
      aria-label={expanded ? labels.grouping.collapse(label) : labels.grouping.expand(label)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => actions.toggleGroup(groupId)}
    >
      <ChevronRight className={cn("transition-transform", expanded ? "rotate-90" : "rtl:rotate-180")} />
    </Button>
  );
}
