import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DataGrid,
  DataGridBody,
  DataGridHeader,
  DataGridRoot,
  type ColumnDef,
} from "../data-grid";

type Row = { id: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "Id", accessorKey: "id" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i) }));
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 360,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function heightWarnings(warn: { mock: { calls: unknown[][] } }): unknown[][] {
  return warn.mock.calls.filter((call) =>
    String(call[0]).includes("browser height limit"),
  );
}

function mount(rowCount: number) {
  return render(
    <DataGrid
      defaultData={makeRows(rowCount)}
      columns={columns}
      getRowId={(row) => row.id}
    >
      <DataGridRoot>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGrid>,
  );
}

describe("browser height limit warning", () => {
  it("warns once per instance when rows x rowHeight exceeds the limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = mount(900_000);
    view.rerender(
      <DataGrid
        defaultData={makeRows(900_000)}
        columns={columns}
        getRowId={(row) => row.id}
      >
        <DataGridRoot>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGrid>,
    );
    expect(heightWarnings(warn)).toHaveLength(1);
    expect(String(heightWarnings(warn)[0]?.[0])).toContain("900000 rows");
    expect(String(heightWarnings(warn)[0]?.[0])).toContain("Rows past about 490,000 are unreachable");
  });

  it("stays silent at 480,000 rows with the default row height", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(480_000);
    expect(heightWarnings(warn)).toHaveLength(0);
  });

  it("stays silent in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(900_000);
    expect(heightWarnings(warn)).toHaveLength(0);
  });
});
