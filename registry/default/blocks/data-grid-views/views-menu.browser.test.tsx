import axe from "axe-core";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridViews } from "./views-menu";
import { createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewsDocument } from "./view-state";
// real stylesheet so the popover layout and tokens apply
import "@/app/global.css";

type Row = { id: string; name: string };
const rows: Row[] = [{ id: "r0", name: "Alice" }];
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 }] as const);

const doc = (): DataGridViewsDocument => ({
  version: 1,
  defaultViewId: "a",
  views: [
    { id: "a", name: "Alpha", state: { ...emptyViewState(), searchText: "al" } },
    { id: "b", name: "Beta", state: emptyViewState() },
  ],
});

function renderViews(dir: "ltr" | "rtl" = "ltr") {
  return render(
    <main dir={dir}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <DataGridViews storage={createMemoryViewsStorage(doc())} />
        <DataGridRoot className="h-40">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </main>,
  );
}

async function violations() {
  // Base UI focus guards are aria-hidden on purpose and focusable by design
  const results = await axe.run({ include: [["body"]], exclude: [["[data-base-ui-focus-guard]"]] }, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => `${v.id}: ${v.help}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("DataGridViews in a browser", () => {
  it("opens from the keyboard, applies the default view, and has no axe violations", async () => {
    await renderViews();
    await expect.element(page.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    await userEvent.keyboard("{Tab}");
    await page.getByRole("button", { name: "Alpha" }).click();
    await expect.element(page.getByRole("list", { name: "Views" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("renames with the keyboard and Escape cancels without closing the popover", async () => {
    await renderViews();
    await page.getByRole("button", { name: "Alpha" }).click();
    await page.getByRole("button", { name: "Rename Beta" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: "Rename Beta" })).toBeInTheDocument();
    await expect.element(page.getByRole("list", { name: "Views" })).toBeInTheDocument();
  });

  it("lays out in a right-to-left page without axe violations", async () => {
    await renderViews("rtl");
    await page.getByRole("button", { name: "Alpha" }).click();
    await expect.element(page.getByRole("list", { name: "Views" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });
});
