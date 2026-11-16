import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, dateCellType, numberCellType, useDataGridActions, useDataGridAllColumns, useDataGridLabels, type ColumnDef } from "../data-grid";
import { DataGridStatusBar } from "../../data-grid-status-bar/data-grid-status-bar";

afterEach(cleanup);

type Row = { id: string; amount: number; day: string };
const rows: Row[] = [
  { id: "1", amount: 1234.5, day: "2026-07-03" },
  { id: "2", amount: 2000, day: "2026-07-04" },
];

const columns = (): readonly ColumnDef<Row, unknown>[] => [
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", options: { format: { useGrouping: true } } },
  { id: "pinnedLocale", header: "Own", accessorKey: "amount", type: "number", options: { format: { useGrouping: true }, locale: "fr-FR" } },
  { id: "day", header: "Day", accessorKey: "day", type: "date", options: { displayFormat: { dateStyle: "long" } } },
];

let allColumns: readonly ColumnDef<Row, unknown>[] = [];
let labels: ReturnType<typeof useDataGridLabels> | null = null;
let actions: ReturnType<typeof useDataGridActions> | null = null;
function Probe() {
  allColumns = useDataGridAllColumns<Row>() as readonly ColumnDef<Row, unknown>[];
  labels = useDataGridLabels();
  actions = useDataGridActions();
  return null;
}

const display = (id: string, value: unknown): string => {
  const column = allColumns.find((c) => c.id === id)!;
  const type = column.type === "date" ? dateCellType : numberCellType;
  return type.toDisplayText!(value as never, column.options as never) as string;
};

const mount = (locale?: string, children: ReactNode = null) =>
  render(
    <DataGridProvider data={rows} columns={columns()} getRowId={(r) => r.id} locale={locale}>
      <Probe />
      {children}
    </DataGridProvider>,
  );

describe("grid locale", () => {
  it("number and date columns format in en-US without a locale", () => {
    mount();
    expect(display("amount", 1234.5)).toBe("1,234.5");
    expect(display("day", "2026-07-03")).toBe("July 3, 2026");
  });

  it("number and date columns read the locale of the grid", () => {
    mount("de-DE");
    expect(display("amount", 1234.5)).toBe("1.234,5");
    expect(display("day", "2026-07-03")).toBe("3. Juli 2026");
  });

  it("the grid locale raises no locale-without-format warning on unformatted number and date columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <DataGridProvider
        data={rows}
        columns={[
          { id: "plainAmount", header: "Amount", accessorKey: "amount", type: "number" },
          { id: "plainDay", header: "Day", accessorKey: "day", type: "date" },
        ]}
        getRowId={(r) => r.id}
        locale="sv-SE"
      >
        <Probe />
      </DataGridProvider>,
    );
    expect(display("plainAmount", 1234.5)).toBe("1234.5");
    expect(display("plainDay", "2026-07-03")).toBe("2026-07-03");
    expect(warn.mock.calls.filter(([message]) => String(message).includes("without"))).toEqual([]);
    warn.mockRestore();
  });

  it("a column options.locale wins over the grid locale", () => {
    mount("de-DE");
    expect(display("pinnedLocale", 1234.5)).toBe(new Intl.NumberFormat("fr-FR").format(1234.5));
  });

  it("the default labels format their numbers in the locale", () => {
    mount();
    expect(labels!.grid.resultsCount(1234)).toBe("1,234 rows");
    cleanup();
    mount("de-DE");
    expect(labels!.grid.resultsCount(1234)).toBe("1.234 rows");
  });

  it("a labels override wins over the locale", () => {
    render(
      <DataGridProvider data={rows} columns={columns()} getRowId={(r) => r.id} locale="de-DE" labels={{ grid: { resultsCount: (n) => `${n} Zeilen` } }}>
        <Probe />
      </DataGridProvider>,
    );
    expect(labels!.grid.resultsCount(1234)).toBe("1234 Zeilen");
  });

  it("a locale change re-resolves the columns and keeps a column locale of its own", () => {
    const { rerender } = mount("de-DE");
    expect(display("amount", 1234.5)).toBe("1.234,5");
    rerender(
      <DataGridProvider data={rows} columns={allColumns} getRowId={(r) => r.id} locale="en-US">
        <Probe />
      </DataGridProvider>,
    );
    expect(display("amount", 1234.5)).toBe("1,234.5");
    expect(display("pinnedLocale", 1234.5)).toBe(new Intl.NumberFormat("fr-FR").format(1234.5));
  });

  it("the status bar default format reads the locale, and formatValue wins", () => {
    mount("de-DE", <DataGridStatusBar />);
    act(() => {
      actions!.selectCellAt({ row: 0, col: 0 });
      actions!.extendToAt({ row: 1, col: 0 });
    });
    expect(screen.getByRole("status").textContent).toContain("Sum 3.234,5");
    cleanup();
    mount("de-DE", <DataGridStatusBar />);
    act(() => {
      actions!.selectCellAt({ row: 0, col: 0 });
      actions!.extendToAt({ row: 1, col: 1 });
    });
    expect(screen.getByRole("status").textContent).toContain("Max 2.000");
    cleanup();
    mount("de-DE", <DataGridStatusBar formatValue={(value) => `#${value}`} />);
    act(() => {
      actions!.selectCellAt({ row: 0, col: 0 });
      actions!.extendToAt({ row: 1, col: 0 });
    });
    expect(screen.getByRole("status").textContent).toContain("Sum #3234.5");
  });
});
