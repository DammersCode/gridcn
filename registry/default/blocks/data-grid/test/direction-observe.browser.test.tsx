import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, type ColumnDefOf } from "../data-grid";
import "@/app/global.css";

const columns: ColumnDefOf<{ id: string; name: string }>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data = [{ id: "r1", name: "A" }];

const gridDir = () => document.querySelector('[role="grid"]')?.getAttribute("dir");

afterEach(() => {
  document.documentElement.removeAttribute("dir");
});

describe("inherited direction", () => {
  it("dir change flips layout", async () => {
    document.documentElement.dir = "rtl";
    await render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-label="People" />);
    await expect.poll(gridDir).toBe("rtl");
    document.documentElement.dir = "ltr";
    await expect.poll(gridDir).toBe("ltr");
    document.documentElement.dir = "rtl";
    await expect.poll(gridDir).toBe("rtl");
  });

  it("the direction prop overrides the page", async () => {
    document.documentElement.dir = "rtl";
    await render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-label="People" direction="ltr" />);
    expect(gridDir()).toBe("ltr");
    document.documentElement.dir = "ltr";
    document.documentElement.dir = "rtl";
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gridDir()).toBe("ltr");
  });
});
