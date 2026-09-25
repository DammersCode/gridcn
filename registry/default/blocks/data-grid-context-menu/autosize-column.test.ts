import { describe, expect, it, vi } from "vitest";
import { autosizeColumn } from "./autosize-column";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";

function makeColumn(overrides: Partial<ColumnDef<unknown, unknown>> = {}): ColumnDef<unknown, unknown> {
  return { id: "name", header: "Name", accessorKey: "name", ...overrides };
}

describe("autosizeColumn", () => {
  it("resolves width from the header text and rendered cells when root is null", () => {
    const commitWidth = vi.fn();
    autosizeColumn(null, makeColumn(), commitWidth);
    // jsdom has no real canvas 2d context, so measurement clamps to the absolute min width (32).
    expect(commitWidth).toHaveBeenCalledWith("name", 32);
  });

  it("reads rendered gridcells for the column id under root", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div role="gridcell" data-column-id="name">Alice</div>
      <div role="gridcell" data-column-id="other">skip</div>
    `;
    document.body.appendChild(root);
    const commitWidth = vi.fn();
    autosizeColumn(root, makeColumn(), commitWidth);
    expect(commitWidth).toHaveBeenCalledWith("name", expect.any(Number));
    document.body.removeChild(root);
  });

  it("uses headerText override when present, and respects column minWidth", () => {
    const commitWidth = vi.fn();
    autosizeColumn(null, makeColumn({ headerText: "Full Name", minWidth: 200 }), commitWidth);
    expect(commitWidth).toHaveBeenCalledWith("name", 200);
  });

  it("falls back to the column id when header is not a string (a ReactNode header)", () => {
    const commitWidth = vi.fn();
    const reactNodeHeader = { type: "span", props: {}, key: null } as unknown as ColumnDef<unknown, unknown>["header"];
    autosizeColumn(null, makeColumn({ header: reactNodeHeader }), commitWidth);
    expect(commitWidth).toHaveBeenCalledWith("name", 32);
  });
});
