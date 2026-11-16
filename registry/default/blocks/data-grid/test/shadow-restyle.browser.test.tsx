import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, type ColumnDefOf } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

const columns: ColumnDefOf<{ id: string }>[] = [{ id: "id", header: "Id", accessorKey: "id" }];
const data = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));

afterEach(() => {
  document.querySelector("style[data-test-restyle]")?.remove();
});

describe("scroll shadow", () => {
  it("plain rule restyles shadow", async () => {
    const style = document.createElement("style");
    style.setAttribute("data-test-restyle", "");
    style.textContent = '[data-grid-pin-shadow="end"]:not([data-pinned]) { background-image: linear-gradient(to left, rgb(0, 0, 255), transparent); }';
    document.head.append(style);
    await render(
      <div style={{ height: 300, width: 300 }}>
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-label="People" className="h-[300px] w-75" />
      </div>,
    );
    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "end"))!;
    expect(getComputedStyle(shadow).backgroundImage).toContain("rgb(0, 0, 255)");
  });
});
