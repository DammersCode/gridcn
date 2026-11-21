import { displayText, exportText } from "../cell-types/display-text";
import { toSafeText } from "../cell-types/safe-text";
import { buildColumnGroupModel, type ColumnGroupModel } from "../columns/column-groups";
import type { CellType } from "../types";
import type { GroupLayout, GroupNode, ServerGroupLayout, ServerPivotLayout } from "../group-types";
import { isDev } from "../is-dev";
import type { DataGridPivotLabels } from "../labels";
import { buildPivotColumns, type PivotColumnDef } from "../pivot-columns";
import type { AnyColumnDef } from "./types";
import { groupIndexAt, groupLayoutOfView } from "./view-rows";

/** The generated columns of the held set and their header groups. Present only under pivot. */
export type PivotView = {
  readonly columnId: string;
  readonly columns: readonly PivotColumnDef<unknown>[];
  readonly groupModel: ColumnGroupModel | null;
  readonly omitted: number;
};

const GENERATED_PREFIXES = ["__pivot:", "__pivotgroup:"] as const;

const hasGeneratedPrefix = (id: string) => GENERATED_PREFIXES.some((prefix) => id.startsWith(prefix));

// Keyed on the held columns, so a landing that changes only `omitted` keeps the generated column defs.
const views = new WeakMap<ServerPivotLayout["columns"], { valueColumns: readonly (AnyColumnDef | undefined)[]; labels: DataGridPivotLabels; view: PivotView }>();

/**
 * The pivot view of a server layout, or `null` without a held set. Its `columns` keep one identity per held columns, value
 * column defs, and labels; a new `omitted` makes a new view over the same `columns`.
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
  const valueColumns = held.values.map((value) => columns.find((column) => column.id === value.columnId));
  const cached = views.get(held.columns);
  if (cached && cached.labels === labels && cached.valueColumns.every((column, i) => column === valueColumns[i])) {
    const omitted = Math.max(0, held.omitted) + Math.max(0, held.columns.length - cached.view.columns.length);
    if (cached.view.omitted !== omitted) cached.view = { ...cached.view, omitted };
    return cached.view;
  }
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
  views.set(held.columns, { valueColumns, labels, view });
  return view;
}

const visibleCache = new WeakMap<PivotView["columns"], { groupColumn: AnyColumnDef | undefined; visible: readonly AnyColumnDef[] }>();

/** Under pivot the visible columns are the `groupBy` column, first and never end-pinned, and the generated columns. */
export function pivotVisibleColumns(view: PivotView, columns: readonly AnyColumnDef[], groupBy: readonly string[]): readonly AnyColumnDef[] {
  const groupColumn = columns.find((column) => column.id === groupBy[0] && !hasGeneratedPrefix(column.id));
  const cached = visibleCache.get(view.columns);
  if (cached && cached.groupColumn === groupColumn) return cached.visible;
  const lead = groupColumn === undefined ? [] : [groupColumn.pin === "end" ? { ...groupColumn, pin: undefined } : groupColumn];
  const visible = [...lead, ...view.columns];
  visibleCache.set(view.columns, { groupColumn, visible });
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

const DEFAULT_AGGREGATE_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };

const aggregateOptions = new WeakMap<AnyColumnDef, { locale: string; options: unknown }>();

/** An average has no natural precision, so a number column without its own `format` or `decimals` shows at most two fraction digits. */
function aggregateOptionsOf(column: AnyColumnDef, locale: string): unknown {
  const cached = aggregateOptions.get(column);
  if (cached?.locale === locale) return cached.options;
  const own = (column.options ?? {}) as { format?: unknown; decimals?: unknown; locale?: string };
  const options = own.format === undefined && own.decimals === undefined ? { ...own, format: DEFAULT_AGGREGATE_FORMAT, locale: own.locale ?? locale } : column.options;
  aggregateOptions.set(column, { locale, options });
  return options;
}

/** The display text of a group aggregate or a pivot cell: empty for no value, else the column's cell type text. */
export function aggregateText(column: AnyColumnDef, value: unknown, cellTypes: Readonly<Record<string, CellType | undefined>>, locale: string): string {
  if (value === null || value === undefined) return "";
  const cellType = cellTypes[column.type ?? "text"];
  try {
    const options = column.type === "number" && (typeof value === "number" || typeof value === "string") ? aggregateOptionsOf(column, locale) : column.options;
    return toSafeText(cellType ? displayText(cellType as Parameters<typeof displayText>[0], value, options) : value);
  } catch {
    return toSafeText(value);
  }
}

type PivotTextState = { readonly viewIndex: ArrayLike<number>; readonly groupLayout: GroupLayout | null; readonly cellTypes: Readonly<Record<string, CellType | undefined>>; readonly locale: string };

/**
 * The text of a pivot row in `column`, which copy, export, print, find, and autosize read: for a generated column the shown text
 * (`"display"`, the default) or the cell type's `toText` (`"export"`), empty for no value; the row's own key text in the first
 * `groupBy` column at every depth; `undefined` off a pivot row.
 */
export function pivotCellText(s: PivotTextState & { readonly pivot: PivotView | null; readonly groupBy?: readonly string[] }, viewRow: number, column: AnyColumnDef | undefined, text: "display" | "export" = "display"): string | undefined {
  if (s.pivot === null || column === undefined) return undefined;
  const groupIndex = groupIndexAt(s.viewIndex, viewRow);
  const node = groupIndex === undefined ? undefined : s.groupLayout?.rows[groupIndex];
  if (node === undefined) return undefined;
  if (isPivotColumn(column)) {
    const value = pivotCellOf(node, column);
    if (text === "display") return aggregateText(column, value, s.cellTypes, s.locale);
    const cellType = s.cellTypes[column.type ?? "text"];
    return value === null ? "" : cellType ? exportText(cellType as Parameters<typeof exportText>[0], value, column.options) : toSafeText(value);
  }
  return column.id === (s.groupBy?.[0] ?? node.columnId) ? node.label : "";
}

/** The quick-search text of the pivot rows of `view`: the pivot cells, the row's key text in the `groupBy` column, `undefined` elsewhere. */
export function pivotTextReader(view: readonly number[], visibleColumns: readonly AnyColumnDef[], cellTypes: Readonly<Record<string, CellType | undefined>>, locale: string): (viewRow: number, columnId: string) => string | undefined {
  const pivotColumns = new Map(visibleColumns.filter(isPivotColumn).map((column) => [column.id, column] as const));
  if (pivotColumns.size === 0) return () => undefined;
  // Under pivot the only visible column that is not generated is the `groupBy` column.
  const keyColumnId = visibleColumns.find((column) => !isPivotColumn(column))?.id;
  const rows = groupLayoutOfView(view)?.rows;
  return (viewRow, columnId) => {
    const column = pivotColumns.get(columnId);
    if (column === undefined && columnId !== keyColumnId) return undefined;
    const groupIndex = groupIndexAt(view, viewRow);
    const node = groupIndex === undefined ? undefined : rows?.[groupIndex];
    if (column === undefined) return node?.label;
    return aggregateText(column, pivotCellOf(node, column), cellTypes, locale);
  };
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
