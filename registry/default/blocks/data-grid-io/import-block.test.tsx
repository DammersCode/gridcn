import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { DataGridProvider } from "@/registry/default/blocks/data-grid/data-grid";
import { useImportBlock } from "./import-dialog";

const wrapper = (readOnly: boolean) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={[]} columns={[]} readOnly={readOnly}>
        {children}
      </DataGridProvider>
    );
  };

describe("useImportBlock", () => {
  it("blocks import on a readOnly grid, also with onImport", () => {
    const onImport = async () => {};
    expect(renderHook(() => useImportBlock(onImport), { wrapper: wrapper(true) }).result.current).toBe("importReadOnly");
    expect(renderHook(() => useImportBlock(undefined), { wrapper: wrapper(true) }).result.current).toBe("importReadOnly");
    expect(renderHook(() => useImportBlock(onImport), { wrapper: wrapper(false) }).result.current).toBeNull();
  });
});
