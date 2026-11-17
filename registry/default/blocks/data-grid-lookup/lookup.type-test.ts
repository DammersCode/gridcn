/**
 * Compile-time-only check: the add-on ships the `GridCellTypes` augmentation, and
 * `LookupOptions<Row>` types `request.row` without a cast. The tsc gate typechecks this file.
 */
import { defineColumns } from "../data-grid/data-grid";
import type { LookupOptions, LookupValue } from "./data-grid-lookup";

type Order = { id: string; country: string; customer: LookupValue; qty: number };

const customerOptions: LookupOptions<Order> = {
  fetchOptions: async ({ row }) => [{ value: row.country, label: row.country }],
};

export const columns = defineColumns<Order>()([
  { id: "customer", header: "Customer", accessorKey: "customer", type: "lookup", options: customerOptions },
  // @ts-expect-error a lookup column reads a LookupValue field
  { id: "qty", header: "Qty", accessorKey: "qty", type: "lookup", options: customerOptions },
]);

const untypedRow: LookupOptions = { fetchOptions: async ({ row }) => [{ value: String(row), label: "x" }] };
void untypedRow;

const resolving: LookupOptions<Order> = {
  fetchOptions: async () => [],
  resolveLabels: async ({ labels, signal }) => (signal.aborted ? [] : labels.map((label) => ({ value: label, label }))),
  labelCacheKey: "tenant-a",
};
void resolving;
