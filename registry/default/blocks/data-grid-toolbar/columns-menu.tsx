"use client";

import { useMemo, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useDataGridActions,
  useDataGridAllColumns,
  useDataGridColumnGroupModel,
  useDataGridIsColumnHidden,
  useDataGridLabels,
  type AnyColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, groupPathOf, type ColumnGroupModel } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Props for {@link DataGridColumnsMenu}. */
export type DataGridColumnsMenuProps = {
  className?: string;
};

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
      {columnLabelText(column)}
    </DropdownMenuCheckboxItem>
  );
}

type MenuSection = { key: string; heading: string | null; columns: AnyColumnDef[] };

/** Consecutive columns of the same innermost group form one section, headed by the group path. */
function menuSections(columns: readonly AnyColumnDef[], model: ColumnGroupModel | null): MenuSection[] {
  const sections: MenuSection[] = [];
  for (const column of columns) {
    const path = groupPathOf(model, column.id);
    const key = path.join("/");
    const last = sections.at(-1);
    if (last && last.key === key) {
      last.columns.push(column);
      continue;
    }
    const heading =
      path.length === 0
        ? null
        : path
            .map((id) => {
              const def = model?.groups.get(id)?.def;
              return def?.headerText ?? (typeof def?.header === "string" ? def.header : id);
            })
            .join(" / ");
    sections.push({ key, heading, columns: [column] });
  }
  return sections;
}

/**
 * Show/hide-only column visibility dropdown — pin controls live in the header dropdown /
 * context menu instead. Each row is a
 * `DropdownMenuCheckboxItem` with the standard trailing check-mark indicator, not a square Checkbox.
 */
export function DataGridColumnsMenu(props: DataGridColumnsMenuProps): ReactNode {
  const { className } = props;
  const columns = useDataGridAllColumns();
  const model = useDataGridColumnGroupModel();
  const sections = useMemo(() => menuSections(columns, model), [columns, model]);
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
        {sections.map((section) =>
          section.heading === null ? (
            section.columns.map((column) => <ColumnRow key={column.id} column={column} />)
          ) : (
            <DropdownMenuGroup key={`${section.key}:${section.columns[0]!.id}`}>
              <DropdownMenuLabel>{section.heading}</DropdownMenuLabel>
              {section.columns.map((column) => (
                <ColumnRow key={column.id} column={column} />
              ))}
            </DropdownMenuGroup>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
