import { buildColumnGroupModel, type ColumnGroupModel } from "../columns/column-groups";
import type { GroupLayout, GroupNode, ServerGroupLayout, ServerPivotLayout } from "../group-types";
import { isDev } from "../is-dev";
import type { DataGridPivotLabels } from "../labels";
import { buildPivotColumns, type PivotColumnDef } from "../pivot-columns";
import type { AnyColumnDef } from "./types";
import { groupIndexAt } from "./view-rows";

/** The generated columns of the held set and their header groups. Present only under pivot. */
export type PivotView = {
  readonly columnId: string;
  readonly columns: readonly PivotColumnDef<unknown>[];
  readonly groupModel: ColumnGroupModel | null;
  readonly omitted: number;
};

const GENERATED_PREFIXES = ["__pivot:", "__pivotgroup:"] as const;

const hasGeneratedPrefix = (id: string) => GENERATED_PREFIXES.some((prefix) => id.startsWith(prefix));

const views = new WeakMap<ServerPivotLayout, { columns: readonly AnyColumnDef[]; labels: DataGridPivotLabels; view: PivotView }>();

/**
 * The pivot view of a server layout, or `null` without a held set. One identity per held set, source columns, and labels.
 * Under pivot, a consumer column or group id with a generated prefix drops, and `onPrefixClash` reports it.
 */
export function pivotViewOf(
  layout: ServerGroupLayout | null,
  columns: readonly AnyColumnDef[],
  consumerGroupIds: Iterable<string>,
  labels: DataGridPivotLabels,
  onPrefixClash: (ids: readonly string[]) => void,
): PivotView | null {
  const held = layout?.pivot;
  if (!held) return null;
  const cached = views.get(held);
  if (cached && cached.columns === columns && cached.labels === labels) return cached.view;
  const clashes = [...columns.map((column) => column.id), ...consumerGroupIds].filter(hasGeneratedPrefix);
  if (clashes.length > 0) onPrefixClash(clashes);
  const sources = clashes.length > 0 ? columns.filter((column) => !hasGeneratedPrefix(column.id)) : columns;
  const built = buildPivotColumns(held, sources, labels);
  const view: PivotView = {
    columnId: held.columnId,
    columns: built.columns as PivotColumnDef<unknown>[],
    groupModel: buildColumnGroupModel(built.groups, built.columns.map((column) => column.id)),
    omitted: Math.max(0, held.omitted) + Math.max(0, held.columns.length - built.columns.length),
  };
  views.set(held, { columns, labels, view });
  return view;
}

const visibleCache = new WeakMap<PivotView, { groupColumn: AnyColumnDef | undefined; visible: readonly AnyColumnDef[] }>();

/** Under pivot the visible columns are the `groupBy` column, first and never end-pinned, and the generated columns. */
export function pivotVisibleColumns(view: PivotView, columns: readonly AnyColumnDef[], groupBy: readonly string[]): readonly AnyColumnDef[] {
  const groupColumn = columns.find((column) => column.id === groupBy[0] && !hasGeneratedPrefix(column.id));
  const cached = visibleCache.get(view);
  if (cached && cached.groupColumn === groupColumn) return cached.visible;
  const lead = groupColumn === undefined ? [] : [groupColumn.pin === "end" ? { ...groupColumn, pin: undefined } : groupColumn];
  const visible = [...lead, ...view.columns];
  visibleCache.set(view, { groupColumn, visible });
  return visible;
}

/** Whether `column` is a generated column. */
export function isPivotColumn(column: AnyColumnDef | undefined): column is PivotColumnDef<unknown> {
  return column !== undefined && typeof (column as Partial<PivotColumnDef<unknown>>).pivotIndex === "number";
}

/**
 * The pivot cell at a view row: a number, `null` when no value counted or the row holds no cells, and `undefined` when
 * `column` is not a generated column.
 */
export function pivotCellAt(s: { readonly viewIndex: ArrayLike<number>; readonly groupLayout: GroupLayout | null }, viewRow: number, column: AnyColumnDef | undefined): number | null | undefined {
  if (!isPivotColumn(column)) return undefined;
  const groupIndex = groupIndexAt(s.viewIndex, viewRow);
  return pivotCellOf(groupIndex === undefined ? undefined : s.groupLayout?.rows[groupIndex], column);
}

/** A group row's pivot cell: a number, or `null` when no value counted or the row holds no cells. */
export function pivotCellOf(node: GroupNode | undefined, column: PivotColumnDef<unknown>): number | null {
  const value = node?.pivotCells?.[column.pivotIndex];
  return value === undefined || Number.isNaN(value) ? null : value;
}

/** The widths of the generated columns of `view` in `widths`, for a layout write that drops unknown ids. */
export function pivotWidthsOf(widths: Readonly<Record<string, number>>, view: PivotView | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!view) return out;
  for (const column of view.columns) {
    const width = widths[column.id];
    if (width !== undefined) out[column.id] = width;
  }
  return out;
}

/** `widths` without the generated ids that `columns` does not hold: the layout snapshot never names a generated column. */
export function withoutGeneratedWidths(widths: Record<string, number>, columns: readonly AnyColumnDef[]): Record<string, number> {
  const generated = Object.keys(widths).filter(hasGeneratedPrefix);
  if (generated.length === 0) return widths;
  const known = new Set(columns.map((column) => column.id));
  const out = { ...widths };
  for (const id of generated) if (!known.has(id)) delete out[id];
  return out;
}

/** A reporter for {@link pivotViewOf} that logs one development error per grid. */
export function createPrefixClashReporter(): (ids: readonly string[]) => void {
  let reported = false;
  return (ids) => {
    if (reported || !isDev()) return;
    reported = true;
    console.error(`[data-grid] under pivot, the ids ${ids.slice(0, 5).map((id) => `"${id}"`).join(", ")} start with "__pivot:" or "__pivotgroup:", which generated columns own, so the grid drops them; rename them`);
  };
}
