"use client";

import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridIsColumnHidden,
  useDataGridLabels,
  type AnyColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";

/** Props for {@link DataGridColumnsMenu}. */
export type DataGridColumnsMenuProps = {
  className?: string;
};

/** Column label for the menu row: `headerText`, else the string `header`, else the id. */
function columnLabel(column: AnyColumnDef): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/** One column's visibility row; a separate component so each row subscribes to its own hidden state. */
function ColumnRow(props: { column: AnyColumnDef }): ReactNode {
  const { column } = props;
  const actions = useDataGridActions();
  const hidden = useDataGridIsColumnHidden(column.id);

  return (
    <DropdownMenuCheckboxItem
      checked={!hidden}
      onCheckedChange={(checked) => actions.setColumnHidden(column.id, checked !== true)}
    >
      {columnLabel(column)}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * Show/hide-only column visibility dropdown — pin controls live in the header dropdown /
 * context menu instead. Each row is a
 * `DropdownMenuCheckboxItem` with the standard trailing check-mark indicator, not a square Checkbox.
 */
export function DataGridColumnsMenu(props: DataGridColumnsMenuProps): ReactNode {
  const { className } = props;
  const columns = useDataGridAllColumns();
  const labels = useDataGridLabels();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn(className)} aria-label={labels.toolbar.columnsAriaLabel}>
            <Settings2 />
            {labels.toolbar.columns}
          </Button>
        }
      />
      <DropdownMenuContent data-grid-columns-menu="" align="start" className="w-56">
        {columns.map((column) => (
          <ColumnRow key={column.id} column={column} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
