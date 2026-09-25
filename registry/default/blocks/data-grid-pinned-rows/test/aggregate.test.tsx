import { useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid, useDataGridActions, type ColumnDef, type DataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridAggregateReporter,
  useDataGridAggregate,
  type AggregateSpecs,
  type UseDataGridAggregateOptions,
} from "../use-data-grid-aggregate";

type Row = { id: string; name: string; qty: number; note: string | null };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 80 },
  { id: "note", header: "Note", accessorKey: "note", width: 80 },
];

function makeRows(qtys: readonly (number | null)[]): Row[] {
  return qtys.map((qty, i) => ({ id: String(i), name: `Row ${i}`, qty: qty ?? 0, note: qty === null ? null : `n${i}` }));
}

afterEach(cleanup);

/** Captures both the aggregate result and the store's imperative actions in one subtree, so a test can trigger a filter and read the next aggregate in the same `act`. */
function Capture(props: {
  data: readonly Row[];
  specs: AggregateSpecs;
  options?: UseDataGridAggregateOptions;
  onResult: (row: Record<string, unknown>) => void;
  onActions?: (actions: DataGridActions) => void;
}) {
  const { data, specs, options, onResult, onActions } = props;
  return (
    <DataGrid data={data} columns={columns} getRowId={(r) => r.id}>
      <Inner specs={specs} options={options} onResult={onResult} onActions={onActions} />
    </DataGrid>
  );
}

function Inner(props: {
  specs: AggregateSpecs;
  options?: UseDataGridAggregateOptions;
  onResult: (row: Record<string, unknown>) => void;
  onActions?: (actions: DataGridActions) => void;
}) {
  const { specs, options, onResult, onActions } = props;
  const row = useDataGridAggregate(specs, options);
  const actions = useDataGridActions();
  onResult(row);
  onActions?.(actions);
  return null;
}

describe("useDataGridAggregate — built-in reducers", () => {
  it("sum/avg/min/max/count over a numeric column", () => {
    const results: Record<string, unknown>[] = [];
    render(
      <Capture
        data={makeRows([1, 2, 3, 4])}
        specs={{ qty: "sum" }}
        onResult={(r) => results.push(r)}
      />,
    );
    expect(results.at(-1)).toEqual({ qty: 10 });
  });

  it("avg divides by the non-empty count", () => {
    const results: Record<string, unknown>[] = [];
    render(<Capture data={makeRows([2, 4, 6])} specs={{ qty: "avg" }} onResult={(r) => results.push(r)} />);
    expect(results.at(-1)).toEqual({ qty: 4 });
  });

  it("min and max over the qty column", () => {
    const results: Record<string, unknown>[] = [];
    render(<Capture data={makeRows([5, 1, 9, 3])} specs={{ qty: "min" }} onResult={(r) => results.push(r)} />);
    expect(results.at(-1)).toEqual({ qty: 1 });

    const maxResults: Record<string, unknown>[] = [];
    render(<Capture data={makeRows([5, 1, 9, 3])} specs={{ qty: "max" }} onResult={(r) => maxResults.push(r)} />);
    expect(maxResults.at(-1)).toEqual({ qty: 9 });
  });

  it("count counts non-empty values", () => {
    const results: Record<string, unknown>[] = [];
    render(<Capture data={makeRows([1, null, 3, null])} specs={{ note: "count" }} onResult={(r) => results.push(r)} />);
    expect(results.at(-1)).toEqual({ note: 2 });
  });
});

describe("useDataGridAggregate — custom reducer", () => {
  it("receives every resolved value and its source row, unfiltered", () => {
    const results: Record<string, unknown>[] = [];
    render(
      <Capture
        data={makeRows([1, 2, 3])}
        specs={{ name: (_values, rows) => `${rows.length} rows` }}
        onResult={(r) => results.push(r)}
      />,
    );
    expect(results.at(-1)).toEqual({ name: "3 rows" });
  });

  it("types `rows` as the grid's row type with an explicit generic (no cast needed)", () => {
    const results: Record<string, unknown>[] = [];
    function TypedInner() {
      const specs: AggregateSpecs<Row> = { qty: (_values, rows) => Math.max(...rows.map((r) => r.qty), 0) };
      const row = useDataGridAggregate<Row>(specs);
      results.push(row);
      return null;
    }
    render(
      <DataGrid data={makeRows([1, 9, 3])} columns={columns} getRowId={(r) => r.id}>
        <TypedInner />
      </DataGrid>,
    );
    expect(results.at(-1)).toEqual({ qty: 9 });
  });
});

describe("useDataGridAggregate — unknown spec key", () => {
  const warn = vi.spyOn(console, "warn");
  afterEach(() => warn.mockClear());

  it("omits the key from the result and dev-warns once", () => {
    const results: Record<string, unknown>[] = [];
    render(
      <Capture
        data={makeRows([1, 2, 3])}
        specs={{ qty: "sum", quants: "sum" }}
        onResult={(r) => results.push(r)}
      />,
    );
    expect(results.at(-1)).toEqual({ qty: 6 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("quants");
  });

  it("does not re-warn for a different unknown key (warn-once per app)", () => {
    const results: Record<string, unknown>[] = [];
    render(
      <Capture
        data={makeRows([1, 2, 3])}
        specs={{ weight: "sum" }}
        onResult={(r) => results.push(r)}
      />,
    );
    expect(results.at(-1)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(0);
  });
});

describe("useDataGridAggregate — empty-value skipping", () => {
  it("sum/avg skip rows whose resolved value is null/undefined instead of producing NaN", () => {
    type NullableRow = { id: string; amount: number | null };
    const nullableColumns: readonly ColumnDef<NullableRow, unknown>[] = [{ id: "amount", header: "Amount", accessorKey: "amount", width: 80 }];
    const data: NullableRow[] = [{ id: "a", amount: 10 }, { id: "b", amount: null }, { id: "c", amount: 20 }];
    const results: Record<string, unknown>[] = [];
    render(
      <DataGrid data={data} columns={nullableColumns} getRowId={(r) => r.id}>
        <NullableInner onResult={(r) => results.push(r)} />
      </DataGrid>,
    );
    expect(results.at(-1)).toEqual({ amount: 30 });

    function NullableInner({ onResult }: { onResult: (row: Record<string, unknown>) => void }) {
      const row = useDataGridAggregate({ amount: "sum" });
      onResult(row);
      return null;
    }
  });
});

describe("useDataGridAggregate — filter-awareness", () => {
  it("reduces over the filtered view by default, and the aggregate changes when a filter is applied", () => {
    const results: Record<string, unknown>[] = [];
    let actions!: DataGridActions;
    render(
      <Capture
        data={makeRows([1, 2, 3, 4, 5])}
        specs={{ qty: "sum" }}
        onResult={(r) => results.push(r)}
        onActions={(a) => (actions = a)}
      />,
    );
    expect(results.at(-1)).toEqual({ qty: 15 });

    act(() => {
      actions.setFilters([{ columnId: "qty", operator: "gt", value: "2" }]);
    });
    // qty 3 + 4 + 5 = 12, not the unfiltered 15.
    expect(results.at(-1)).toEqual({ qty: 12 });
  });

  it("scope: 'all' ignores the active filter and keeps reducing over the full data array", () => {
    const results: Record<string, unknown>[] = [];
    let actions!: DataGridActions;
    render(
      <Capture
        data={makeRows([1, 2, 3, 4, 5])}
        specs={{ qty: "sum" }}
        options={{ scope: "all" }}
        onResult={(r) => results.push(r)}
        onActions={(a) => (actions = a)}
      />,
    );
    expect(results.at(-1)).toEqual({ qty: 15 });

    act(() => {
      actions.setFilters([{ columnId: "qty", operator: "gt", value: "2" }]);
    });
    expect(results.at(-1)).toEqual({ qty: 15 });
  });
});

describe("DataGridAggregateReporter — effect stability", () => {
  it("an inline onChange that always produces new state does not re-fire the effect into a loop", () => {
    const onTotalsChange = vi.fn();
    const STABLE_SPECS: AggregateSpecs = { qty: "sum" };
    const DATA = makeRows([1, 2, 3]);
    function Parent() {
      const [totals, setTotals] = useState<Record<string, unknown>>({});
      // The docs pattern: inline closure (fresh identity every render) + a spread that always
      // produces a new object. With the effect keyed on `onChange`, this re-fires forever.
      // `specs` and `data` keep module identity so only the `onChange` identity churns.
      return (
        <DataGrid data={DATA} columns={columns} getRowId={(r) => r.id}>
          <DataGridAggregateReporter
            specs={STABLE_SPECS}
            onChange={(row) => {
              onTotalsChange();
              setTotals((prev) => ({ ...prev, ...row }));
            }}
          />
          <span data-testid="totals">{String(totals["qty"])}</span>
        </DataGrid>
      );
    }
    const { getByTestId } = render(<Parent />);
    expect(getByTestId("totals").textContent).toBe("6");
    expect(onTotalsChange).toHaveBeenCalledTimes(1);
  });
});

describe("useDataGridAggregate — sparse (lazy) data", () => {
  const warn = vi.spyOn(console, "warn");

  /** 4 rows, indices 1 and 3 are holes (undefined) — the shape of a partially loaded lazy grid. */
  function sparseRows(): Row[] {
    const sparse: Row[] = new Array(4);
    sparse[0] = { id: "0", name: "A", qty: 1, note: "n0" };
    sparse[2] = { id: "2", name: "C", qty: 3, note: "n2" };
    return sparse;
  }

  it("skips holes instead of throwing (scope view) and dev-warns once", () => {
    const results: Record<string, unknown>[] = [];
    function Inner() {
      const row = useDataGridAggregate({ qty: "sum" });
      results.push(row);
      return null;
    }
    render(
      <DataGrid data={sparseRows()} columns={columns} getRowId={(r) => r.id}>
        <Inner />
      </DataGrid>,
    );
    // qty 1 + 3 over the two loaded rows — the holes are skipped, not summed as NaN.
    expect(results.at(-1)).toEqual({ qty: 4 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips holes over the raw sparse array too (scope all), without re-warning", () => {
    const results: Record<string, unknown>[] = [];
    function AllInner() {
      const row = useDataGridAggregate({ qty: "sum" }, { scope: "all" });
      results.push(row);
      return null;
    }
    render(
      <DataGrid data={sparseRows()} columns={columns} getRowId={(r) => r.id}>
        <AllInner />
      </DataGrid>,
    );
    expect(results.at(-1)).toEqual({ qty: 4 });
    // the warn fires at most once per app, so this second grid stays quiet
    expect(warn).toHaveBeenCalledTimes(0);
  });

  afterEach(() => warn.mockClear());
});

describe("useDataGridAggregate — memoization", () => {
  it("returns the same result reference when viewIndex/data/specs identity is unchanged", () => {
    const compute = vi.fn((values: readonly unknown[], rows: readonly unknown[]) => rows.length);
    const stableSpecs: AggregateSpecs = { name: compute };
    const data = makeRows([1, 2, 3]);
    const results: Record<string, unknown>[] = [];
    let actions!: DataGridActions;
    const { rerender } = render(
      <Capture data={data} specs={stableSpecs} onResult={(r) => results.push(r)} onActions={(a) => (actions = a)} />,
    );
    const first = results.at(-1);
    const callsAfterMount = compute.mock.calls.length;

    // A re-render triggered by an unrelated store write (selection) must not recompute the reducer:
    // same data/specs identity, viewIndex untouched by selection.
    act(() => {
      actions.selectCell({ row: 0, col: 0 });
    });
    rerender(<Capture data={data} specs={stableSpecs} onResult={(r) => results.push(r)} onActions={(a) => (actions = a)} />);
    expect(results.at(-1)).toBe(first);
    expect(compute.mock.calls.length).toBe(callsAfterMount);
  });
});
