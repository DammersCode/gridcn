"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";

type Customer = { id: string; name: string };
type Order = { id: string; customerId: string; total: number };

const customers: Customer[] = [
  { id: "c1", name: "Ada Lovelace" },
  { id: "c2", name: "Grace Hopper" },
  { id: "c3", name: "Alan Turing" },
];

const orders: Order[] = [
  { id: "o1", customerId: "c1", total: 120 },
  { id: "o2", customerId: "c1", total: 45 },
  { id: "o3", customerId: "c2", total: 310 },
  { id: "o4", customerId: "c3", total: 80 },
  { id: "o5", customerId: "c3", total: 15 },
];

const customerColumns = defineColumns<Customer>()([
  { id: "name", header: "Customer", accessorKey: "name", type: "text" },
] as const);

const orderColumns = defineColumns<Order>()([
  { id: "id", header: "Order", accessorKey: "id", type: "text", flex: 1 },
  { id: "total", header: "Total", accessorKey: "total", type: "number", flex: 1 },
] as const);

/** The active cell of the customer grid sets the rows of the read-only order grid through React state. */
export default function DataGridLinkedGridsDemo(): ReactNode {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const customerOrders = useMemo(() => orders.filter((order) => order.customerId === customerId), [customerId]);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Click a customer. The order grid shows the orders of the customer in the active cell.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <DataGrid
          className="h-60"
          defaultData={customers}
          columns={customerColumns}
          onActiveCellChange={(next) => setCustomerId(next?.rowId ?? null)}
        />
        <DataGrid className="h-60" data={customerOrders} columns={orderColumns} readOnly />
      </div>
    </div>
  );
}
