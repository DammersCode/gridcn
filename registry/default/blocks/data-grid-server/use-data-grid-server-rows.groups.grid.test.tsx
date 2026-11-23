import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { ServerRowsAnswer, ServerRowsRequest } from "./read-answer";
import type { ServerGroupsAnswer } from "./read-groups-answer";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

type Row = { id: string; region: string; qty: number };
const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, region: i < 20 ? "east" : "west", qty: 1 }));
const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});
afterEach(cleanup);

const fetchRows = vi.fn(async (request: ServerRowsRequest<never>): Promise<ServerRowsAnswer<Row, never> | ServerGroupsAnswer> => {
  const { start, end, groupPath = [], childKind } = request;
  if (childKind === "groups") return { groups: [{ key: "east", childCount: 20, totalRowCount: 20 }, { key: "west", childCount: 10, totalRowCount: 10 }].slice(start, end), groupCount: 2, totalRowCount: 30 };
  const inside = rows.filter((row) => groupPath.every((segment) => row.region === segment.key));
  return { rows: inside.slice(start, end), totalRowCount: inside.length };
});

function Harness({ rowCalls = fetchRows }: { rowCalls?: typeof fetchRows }) {
  const server = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: rowCalls as never, blockSize: 10, loadDelayMs: 0, defaultSpec: { groupBy: ["region"] } });
  return (
    <DataGridProvider {...server.providerProps} columns={columns}>
      <DataGridRoot aria-label="Sales" {...server.rootProps}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("a grouped server grid", () => {
  it("shows the group rows from the server and opens a group by its toggle", async () => {
    render(<Harness />);
    await waitFor(() => expect(document.querySelectorAll("[data-grid-group-row]")).toHaveLength(2));
    expect(screen.getByRole("treegrid")).toBeTruthy();
    const east = document.querySelectorAll<HTMLElement>("[data-grid-group-row]")[0]!;
    expect(east.getAttribute("aria-expanded")).toBe("false");
    expect(east.textContent).toContain("east");
    await act(async () => void fireEvent.click(within(east).getByRole("button")));
    await waitFor(() => expect(screen.getAllByText("east").length).toBeGreaterThan(2));
    expect(document.querySelectorAll<HTMLElement>("[data-grid-group-row]")[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(fetchRows.mock.calls.some(([request]) => request.childKind === "rows" && request.groupPath?.[0]?.key === "east")).toBe(true);
  });

  it("lands the same collapsed groups twice without the data identity warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let refresh!: () => void;
    function Refreshing() {
      const server = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: fetchRows as never, blockSize: 10, loadDelayMs: 0, defaultSpec: { groupBy: ["region"] } });
      refresh = server.refresh;
      return (
        <DataGridProvider {...server.providerProps} columns={columns}>
          <DataGridRoot aria-label="Sales" {...server.rootProps}>
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    render(<Refreshing />);
    await waitFor(() => expect(document.querySelectorAll("[data-grid-group-row]")).toHaveLength(2));
    const calls = fetchRows.mock.calls.length;
    act(() => refresh());
    await waitFor(() => expect(fetchRows.mock.calls.length).toBeGreaterThan(calls));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));
    expect(warn.mock.calls.filter(([message]) => String(message).includes("data array identity changed"))).toEqual([]);
    warn.mockRestore();
  });

  it("shows and opens a group whose key holds a lone surrogate", async () => {
    const lone = vi.fn(async (request: ServerRowsRequest<never>): Promise<ServerRowsAnswer<Row, never> | ServerGroupsAnswer> => {
      if (request.childKind === "groups") return { groups: [{ key: "\uD800", childCount: 2, totalRowCount: 2 }, { key: "west", childCount: 1, totalRowCount: 1 }], groupCount: 2, totalRowCount: 3 };
      return { rows: [{ id: `${request.groupPath?.[0]?.key}-0`, region: "lone", qty: 1 }], totalRowCount: 1 };
    });
    render(<Harness rowCalls={lone} />);
    await waitFor(() => expect(document.querySelectorAll("[data-grid-group-row]")).toHaveLength(2));
    await act(async () => void fireEvent.click(within(document.querySelectorAll<HTMLElement>("[data-grid-group-row]")[0]!).getByRole("button")));
    await waitFor(() => expect(lone.mock.calls.some(([request]) => request.childKind === "rows" && request.groupPath?.[0]?.key === "\uD800")).toBe(true));
  });
});
