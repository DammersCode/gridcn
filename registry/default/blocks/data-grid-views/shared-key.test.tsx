import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridViews, type UseDataGridViewsOptions } from "./use-data-grid-views";

type Row = { id: string; name: string; city: string };
const nameColumns: ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const cityColumns: ColumnDef<Row, unknown>[] = [{ id: "city", header: "City", accessorKey: "city" }];

function Views(options: UseDataGridViewsOptions) {
  useDataGridViews(options);
  return null;
}

function Grid({ columns, storage }: { columns: ColumnDef<Row, unknown>[]; storage?: string }) {
  return (
    <DataGridProvider data={[]} columns={columns}>
      <Views storage={storage} />
    </DataGridProvider>
  );
}

const sharedKeyWarnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter(([message]) => String(message).includes("share the views storage key"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("views storage key shared by two grids", () => {
  it("warns once in development when two mounted grids with other columns use one key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <Grid columns={nameColumns} />
        <Grid columns={cityColumns} />
      </>,
    );
    expect(sharedKeyWarnings(warn)).toHaveLength(1);
    expect(String(sharedKeyWarnings(warn)[0]![0])).toContain('"gridcn-views"');
  });

  it("stays quiet for grids with their own keys or with the same columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <>
        <Grid columns={nameColumns} storage="a" />
        <Grid columns={cityColumns} storage="b" />
        <Grid columns={nameColumns} />
        <Grid columns={nameColumns} />
      </>,
    );
    expect(sharedKeyWarnings(warn)).toHaveLength(0);
  });
});
