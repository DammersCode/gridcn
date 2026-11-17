import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { DataGridProvider } from "../store";
import { type Row, rows } from "./store-setup.test-helper";

describe("dev-mode guardrails", () => {
  it("warns once per instance on duplicate column ids, not per render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dupCols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "name", header: "Name Again", accessorKey: "name" },
    ];

    const { rerender } = render(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={dupCols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    // once per instance (per duplicated id), not per render
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('duplicate column id "name"')).length).toBe(1);
    warn.mockRestore();
  });

  it("warns once per instance when a column type resolves to nothing in the cellTypes registry", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", type: "number" },
      { id: "bad", header: "Bad", accessorKey: "name", type: "bogus" },
    ];

    const { rerender } = render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    // once per instance (per bad column id + type), not per render
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('type "bogus"')).length).toBe(1);
    warn.mockRestore();
  });

  it("does not warn for a built-in type when the cellTypes prop names only custom types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", type: "custom" as never },
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
    ];
    const custom = { ...cellTypes.text };

    render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id} cellTypes={{ custom } as never}>
        <div />
      </DataGridProvider>,
    );

    expect(warn.mock.calls.filter((c) => String(c[0]).includes("resolves to nothing"))).toEqual([]);
    warn.mockRestore();
  });

  it("warns when a null cellTypes entry removes a type a column uses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age", type: "number" },
    ];

    render(
      <DataGridProvider data={rows()} columns={cols} getRowId={(r) => r.id} cellTypes={{ number: null }}>
        <div />
      </DataGridProvider>,
    );

    expect(warn.mock.calls.filter((c) => String(c[0]).includes('type "number"')).length).toBe(1);
    warn.mockRestore();
  });

  it("warns when the columns array identity changes every render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The churn is constructed by the caller, not inside render, so the compiler has no
    // render-scoped expression to memoize — the provider still sees a fresh array each pass,
    // which is exactly the anti-pattern the guardrail targets.
    const freshColumns = (): readonly ColumnDef<Row, unknown>[] => [
      { id: "name", header: "Name", accessorKey: "name" },
    ];

    function Harness({ columns }: { columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness columns={freshColumns()} />);
    rerender(<Harness columns={freshColumns()} />);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("columns array identity changed"));
    warn.mockRestore();
  });

  it("warns when an inline columns literal rebuilds options.choices or a JSX header every render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const freshColumns = (): readonly ColumnDef<Row, unknown>[] => [
      { id: "name", header: <b>Name</b>, accessorKey: "name", type: "select", options: { choices: [{ value: "a", label: "A" }] } },
    ];

    function Harness({ columns }: { columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness columns={freshColumns()} />);
    rerender(<Harness columns={freshColumns()} />);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("columns array identity changed"));
    warn.mockRestore();
  });

  it("does NOT warn when a rebuilt columns array carries a new function, such as a renderCell over new state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const columnsFor = (suffix: string): readonly ColumnDef<Row, unknown>[] => [{ id: "name", header: "Name", accessorKey: "name", renderCell: ({ value }) => `${String(value)}${suffix}` }];

    function Harness({ columns }: { columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness columns={columnsFor("!")} />);
    rerender(<Harness columns={columnsFor("?")} />);

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("columns array identity changed"));
    warn.mockRestore();
  });

  it("warns once per grid while the columns and data arrays churn on every render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const initial = rows();
    const freshColumns = (): readonly ColumnDef<Row, unknown>[] => [{ id: "name", header: "Name", accessorKey: "name" }];

    // The caller builds the churn, so the compiler has no render-scoped array to memoize.
    function Harness({ data, columns }: { data: readonly Row[]; columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness data={[...initial]} columns={freshColumns()} />);
    rerender(<Harness data={[...initial]} columns={freshColumns()} />);
    rerender(<Harness data={[...initial]} columns={freshColumns()} />);
    rerender(<Harness data={[...initial]} columns={freshColumns()} />);

    const calls = warn.mock.calls.map((call) => String(call[0]));
    expect(calls.filter((text) => text.includes("columns array identity changed"))).toHaveLength(1);
    expect(calls.filter((text) => text.includes("data array identity changed"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("does NOT warn when the columns array changes on purpose (different header or ids) or stays stable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stable: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    const translated: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Nom", accessorKey: "name" }];
    const renamed: readonly ColumnDef<Row, unknown>[] = [{ id: "label", header: "Nom", accessorKey: "name" }];

    function Harness({ columns }: { columns: readonly ColumnDef<Row, unknown>[] }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id}>
          <div />
        </DataGridProvider>
      );
    }

    const { rerender } = render(<Harness columns={stable} />);
    rerender(<Harness columns={stable} />);
    rerender(<Harness columns={translated} />);
    rerender(<Harness columns={renamed} />);

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("columns array identity changed"));
    warn.mockRestore();
  });

  it("does NOT warn on a legitimate immutable single-row edit (new array, one row replaced)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    const initial = rows();

    const { rerender } = render(
      <DataGridProvider data={initial} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    const edited = initial.map((r, i) => (i === 0 ? { ...r, name: "Edited" } : r));
    rerender(
      <DataGridProvider data={edited} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("data array identity changed"));
    warn.mockRestore();
  });

  it("warns when the data array is rebuilt with zero row changes (identity churn)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cols: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
    const initial = rows();

    const { rerender } = render(
      <DataGridProvider data={initial} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );
    rerender(
      <DataGridProvider data={[...initial]} columns={cols} getRowId={(r) => r.id}>
        <div />
      </DataGridProvider>,
    );

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("data array identity changed with no row changes"));
    warn.mockRestore();
  });
});
