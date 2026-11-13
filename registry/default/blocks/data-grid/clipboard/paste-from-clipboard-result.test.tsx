import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { DataGridProvider } from "../store";
import { useDataGridClipboard, type UseDataGridClipboardResult } from "./use-data-grid-clipboard";

type Row = { id: string; n: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "n", header: "N", accessorKey: "n" }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function pasteResult(text: string, readOnly: boolean): Promise<string | undefined> {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { readText: () => Promise.resolve(text) } });
  let clip: UseDataGridClipboardResult | null = null;
  function Probe() {
    clip = useDataGridClipboard();
    return null;
  }
  render(
    <DataGridProvider columns={columns} defaultData={[{ id: "a", n: "x" }]} readOnly={readOnly}>
      <Probe />
    </DataGridProvider>,
  );
  let result: string | undefined;
  await act(async () => {
    result = await clip!.pasteFromClipboard();
  });
  return result;
}

it("a paste that does not start on a readOnly grid resolves 'refused', not 'empty'", async () => {
  expect(await pasteResult("hello", true)).toBe("refused");
});

it("an empty clipboard resolves 'empty'", async () => {
  expect(await pasteResult("", false)).toBe("empty");
});
