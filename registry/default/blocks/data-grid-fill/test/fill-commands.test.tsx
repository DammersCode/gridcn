import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDataGridFill } from "../use-data-grid-fill";

const ctx = { readOnly: false } as never;

describe("fill commands", () => {
  it("leave Ctrl/Cmd+D and Ctrl/Cmd+R to the browser while fill is disabled", () => {
    const { result, rerender } = renderHook(({ disabled }) => useDataGridFill({ disabled }), { initialProps: { disabled: true } });
    const { fillDown, fillRight } = result.current.plugin.commands!;
    expect(fillDown!.when!(ctx)).toBe(false);
    expect(fillRight!.when!(ctx)).toBe(false);
    rerender({ disabled: false });
    expect(fillDown!.when!(ctx)).toBe(true);
  });
});
