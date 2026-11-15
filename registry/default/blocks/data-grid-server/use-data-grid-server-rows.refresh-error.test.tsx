import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Fetch = (request: ServerRowsRequest) => Promise<ServerRowsAnswer<Row>>;

describe("refresh() before block 0 has loaded", () => {
  it("clears the error while it fetches again", async () => {
    let fail = true;
    let release!: () => void;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (fail) throw new Error("down");
      await new Promise<void>((resolve) => (release = resolve));
      return { rows: Array.from({ length: end - start }, (_, i) => ({ id: `row-${start + i}`, name: `Person ${start + i}` })), totalRowCount: 100 };
    });
    const { result } = renderHook(() =>
      useDataGridServerRows<Row>({ mode: "scroll", loadDelayMs: 0, getRowId: (row) => row.id, fetchRows, blockSize: 10, overscan: 0 }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    fail = false;
    act(() => result.current.refresh());
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(null);
    release();
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
