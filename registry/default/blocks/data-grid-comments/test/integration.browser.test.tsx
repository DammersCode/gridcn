import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridComments } from "../data-grid-comments";
import type { CellComment, UseDataGridCommentsOptions } from "../data-grid-comments";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

const seeded: CellComment = { id: "c1", rowId: "r1", columnId: "name", text: "Check", author: { id: "a", name: "Ann" }, createdAt: 1, updatedAt: 1, version: 1, resolved: false };

function Harness({ options = {}, withManual = false, locale, labels }: { options?: UseDataGridCommentsOptions; withManual?: boolean; locale?: string; labels?: { comments?: { menuItem?: string } } }) {
  const comments = useDataGridComments(options);
  return (
    <div style={{ height: 300 }}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[comments.plugin]} locale={locale} labels={labels}>
        <DataGridContextMenu getCellMenuItems={withManual ? comments.getCommentMenuItems : undefined}>
          <DataGridRoot className="h-[300px]" aria-label="grid">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridContextMenu>
      </DataGridProvider>
    </div>
  );
}

describe("comments integration", () => {
  it("the plugin adds the menu item once, with or without getCommentMenuItems", async () => {
    await render(<Harness withManual />);
    await page.getByRole("gridcell").first().click({ button: "right" });
    await expect.element(page.getByRole("menuitem", { name: "Comments…" })).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).filter((el) => el.textContent?.includes("Comments…"))).toHaveLength(1);
  });

  it("labels.comments of the grid renames the menu item", async () => {
    await render(<Harness locale="de-DE" labels={{ comments: { menuItem: "Kommentare…" } }} />);
    await page.getByRole("gridcell").first().click({ button: "right" });
    await expect.element(page.getByRole("menuitem", { name: "Kommentare…" })).toBeInTheDocument();
  });

  it("a function defaultComments seeds after mount", async () => {
    await render(<Harness options={{ defaultComments: () => [seeded] }} />);
    await expect.poll(() => document.querySelectorAll(gridAttrSelector("commentMarker")).length).toBe(1);
  });
});
