"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  cellTypes,
  useSeedFocus,
  useCommitGuard,
  type CellEditorProps,
  type CellRenderProps,
  type CellType,
  type ColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { Input } from "@/components/ui/input";

/**
 * A worked "build your own cell type" example — see /docs/custom-cell-types for the full guide.
 * Storage is a plain `number | null` (currency amounts round-trip as SERIALIZABLE PRIMITIVES, the
 * same lesson the built-in date type follows by storing an ISO string rather than a Date object).
 *
 * The guide's `declare module "@/components/data-grid/types" { interface GridCellTypes {
 * currency: ... } }` augmentation is not repeated here purely to keep this file self-contained —
 * `cell-types.ts`'s built-in registry checks its five built-ins against a literal
 * `BuiltinCellTypeKey` union, decoupled from `GridCellTypes`, so a real augmentation compiles fine
 * alongside it (see builtin-augmentation.type-test.ts). This file types the column locally
 * instead, the same shape `defineColumns` gives you with a real augmentation in your own app.
 */
type CurrencyOptions = { currency: string; locale?: string };

/**
 * Constructing an Intl.NumberFormat is expensive relative to reusing one — the same tradeoff the
 * built-in date type's dateFormatterCache measured (~38us to construct vs ~0.7us to reuse, at
 * fling speed multiplied per visible cell per newly-mounted row). Keyed on serialized options
 * (not object identity) because a column's `options` literal is re-created every render.
 */
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let formatter = currencyFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    currencyFormatterCache.set(key, formatter);
  }
  return formatter;
}

/**
 * Strips currency symbols/whitespace so pasted "$1,234.56" or "1.234,56 EUR" parse. Commas are
 * thousands separators when a "." also appears (US-style grouping) and dropped outright; a lone
 * comma is treated as the decimal separator (EU-style) and normalized to ".".
 */
function stripCurrencySymbols(text: string): string {
  const kept = text.replace(/[^0-9.,-]/g, "");
  return kept.includes(".") ? kept.replace(/,/g, "") : kept.replace(",", ".");
}

function formatCurrencyDisplay(value: number | null, options?: CurrencyOptions): string {
  if (value == null) return "";
  // pinned default (not the runtime's locale): server/browser Intl defaults can differ -> SSR hydration mismatch
  return getCurrencyFormatter(options?.locale ?? "en-US", options?.currency ?? "USD").format(value);
}

function CurrencyCell({ value, column }: CellRenderProps<unknown, number | null>) {
  const options = column.options as CurrencyOptions | undefined;
  return (
    <span className="block w-full truncate tabular-nums">
      {formatCurrencyDisplay(value, options)}
    </span>
  );
}

function CurrencyEditor({
  value,
  initialText,
  onChange,
  commit,
  cancel,
  column,
}: CellEditorProps<unknown, number | null>) {
  const options = column.options as CurrencyOptions | undefined;
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText ?? currencyCellType.toText(value, options));
  // the grid's own editor primitives: effect-based seed-focus (caret at the end) and the one-shot
  // commit guard — the same pair every built-in editor uses, so a custom editor behaves identically
  useSeedFocus(ref, initialText);
  const committed = useCommitGuard();

  const commitText = (movement?: { dx: number; dy: number }) => {
    if (!committed.tryCommit()) return;
    onChange(currencyCellType.fromText(text, options));
    commit(movement);
  };

  return (
    <Input
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          commitText({ dx: 0, dy: 1 });
        } else if (e.key === "Escape") {
          cancel();
        }
      }}
      onBlur={() => commitText({ dx: 0, dy: 0 })}
      className="h-full w-full border-none bg-transparent p-0 text-end shadow-none outline-none focus-visible:ring-0"
    />
  );
}

/** `currency`: number storage, cached locale-formatted display, symbol-stripping fromText (never throws). */
export const currencyCellType: CellType<unknown, number | null, CurrencyOptions> = {
  Cell: CurrencyCell,
  Editor: CurrencyEditor,
  // toText is the canonical (unformatted) serialization used by copy/export/search
  toText: (value) => (value == null ? "" : String(value)),
  toDisplayText: (value, options) => formatCurrencyDisplay(value, options),
  fromText: (text) => {
    const stripped = stripCurrencySymbols(text.trim());
    if (stripped === "") return null;
    const parsed = Number(stripped);
    return Number.isNaN(parsed) ? null : parsed;
  },
  clearValue: () => null,
  isEmpty: (value) => value == null,
  compare: (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return a - b;
  },
  align: "right",
};

type Product = { id: string; name: string; priceUsd: number | null; priceEur: number | null };

const PRODUCTS: Product[] = [
  { id: "p1", name: "Mechanical Keyboard", priceUsd: 129.99, priceEur: 119.5 },
  { id: "p2", name: "4K Monitor", priceUsd: 449, priceEur: 415 },
  { id: "p3", name: "USB-C Dock", priceUsd: 79.5, priceEur: 74 },
  { id: "p4", name: "Webcam", priceUsd: 59, priceEur: null },
];

const typedColumns = defineColumns<Product>()([
  { id: "name", header: "Product", accessorKey: "name", type: "text", width: 130, flex: 2 },
] as const);

// With the guide's real `declare module` augmentation in a consumer app, `defineColumns` narrows
// `type: "currency"` / `options: CurrencyOptions` the same way it does for the built-ins above —
// written by hand here only because this repo's shared tsconfig can't carry that augmentation.
const currencyColumns: ColumnDef<Product, number | null>[] = [
  {
    id: "priceUsd",
    header: "USD",
    accessorKey: "priceUsd",
    type: "currency",
    options: { currency: "USD" } satisfies CurrencyOptions,
    width: 90,
    flex: 1,
  },
  {
    id: "priceEur",
    header: "EUR",
    accessorKey: "priceEur",
    type: "currency",
    options: { currency: "EUR", locale: "de-DE" } satisfies CurrencyOptions,
    width: 90,
    flex: 1,
  },
];

const columns = [...typedColumns, ...currencyColumns];

/**
 * The custom-cell-types guide's worked example: a `currency` cell type registered via the
 * `cellTypes` prop (see /docs/custom-cell-types for the `GridCellTypes` augmentation this would
 * get in a real consumer app). Try editing a cell — type a value with a currency symbol (e.g.
 * "$1,234.56") and press Enter; `fromText` strips it back to a plain number.
 */
export default function DataGridCustomCellDemo(): ReactNode {
  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Edit a USD or EUR price cell and type a value with a currency symbol (e.g.
        &quot;$1,234.56&quot;) and press Enter: the custom cell type strips the symbol back to a
        plain number before it commits.
      </p>
      <div className="h-[220px] overflow-hidden rounded-md border border-border">
        {/* spread the built-ins in: `cellTypes` REPLACES the whole registry, it does not merge — omitting `...cellTypes` here would silently break every `text`/`number`/etc. column too */}
        <DataGridProvider
          defaultData={PRODUCTS}
          columns={columns}
          getRowId={(row) => row.id}
          cellTypes={{ ...cellTypes, currency: currencyCellType }}
        >
          <DataGridRoot className="h-full rounded-none border-none">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    </div>
  );
}
