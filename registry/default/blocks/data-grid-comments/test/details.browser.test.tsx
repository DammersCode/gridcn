import { useState } from "react";
import { cdp, page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, useDataGridApi, type DataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridComments } from "../data-grid-comments";
import type { CellComment, UseDataGridCommentsOptions, UseDataGridCommentsResult } from "../data-grid-comments";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);
const alice = { id: "alice", name: "Alice" };

function comment(overrides: Partial<CellComment> = {}): CellComment {
  return { id: "c1", rowId: "r1", columnId: "name", text: "Mine", author: alice, createdAt: Date.UTC(2026, 0, 5, 10, 0), updatedAt: 1, version: 1, writeId: "w0", resolved: false, ...overrides };
}

let handle: UseDataGridCommentsResult | undefined;
let api: DataGridApi<Row> | undefined;

function Probe() {
  api = useDataGridApi<Row>();
  return null;
}

function Harness({ options = {}, data = rows, readOnly = false }: { options?: UseDataGridCommentsOptions; data?: Row[]; readOnly?: boolean }) {
  const comments = useDataGridComments({ currentUser: alice, ...options });
  handle = comments;
  const [initial] = useState(data);
  return (
    <div style={{ height: 300 }}>
      <DataGridProvider defaultData={initial} columns={columns} getRowId={(r) => r.id} plugins={[comments.plugin]} readOnly={readOnly}>
        <Probe />
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

const markers = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(gridAttrSelector("commentMarker")));
const popup = (): HTMLElement | null => document.querySelector<HTMLElement>(gridAttrSelector("commentsPopup"));
const announcer = (): string => document.querySelector("[data-grid-comments-announcer]")?.textContent ?? "";

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
});

describe("comments: escape, announcer, hints", () => {
  it("Escape cancels the delete confirmation first and closes the popover second", async () => {
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    await page.getByRole("button", { name: /^Delete comment by Alice/ }).click();
    await expect.element(page.getByRole("button", { name: /^Confirm delete/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("button", { name: /^Confirm delete/ })).not.toBeInTheDocument();
    expect(popup()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
  });

  it("the announcer reports the count and the bound chord once the active cell lands on a commented cell", async () => {
    await render(<Harness options={{ defaultComments: [comment(), comment({ id: "c2", resolved: true })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    await page.getByRole("gridcell").first().click();
    expect(announcer()).toBe("");
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(announcer, { timeout: 2000 }).toBe("2 comments, 1 unresolved. Press Shift+F2 to open.");
  });

  it("the announcer stays silent while focus is outside the grid", async () => {
    await render(
      <div>
        <button type="button">outside</button>
        <Harness options={{ defaultComments: [comment()] }} />
      </div>,
    );
    await expect.poll(() => markers().length).toBe(1);
    api?.actions.selectCell({ rowId: "r1", columnId: "name" });
    await page.getByRole("button", { name: "outside" }).click();
    await new Promise((r) => setTimeout(r, 500));
    expect(announcer()).toBe("");
  });

  it("the popover closes with the draft kept when the cell scrolls out of the rendered rows", async () => {
    await render(<Harness data={Array.from({ length: 400 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}` }))} />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await userEvent.keyboard("still here");
    const grid = document.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
    grid.scrollTop = 8000;
    await expect.poll(() => popup()).toBeNull();
    grid.scrollTop = 0;
    await expect.poll(() => document.querySelector('[role="gridcell"]')).not.toBeNull();
    handle?.openComments({ rowId: "r0", columnId: "name" });
    await expect.element(page.getByRole("textbox", { name: "Write a comment" })).toHaveValue("still here");
  });
});

describe("comments: forced colors and read-only paths", () => {
  it("keeps the marker visible under forced colors", async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    const drawn = markers()[0]?.firstElementChild as HTMLElement;
    const style = getComputedStyle(drawn);
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("a read-only grid refuses edit, delete, resolve, and create programmatically with reason read-only", async () => {
    const reasons: string[] = [];
    await render(<Harness readOnly options={{ defaultComments: [comment()], onCommentRejected: ({ reason }) => reasons.push(reason) }} />);
    await expect.poll(() => markers().length).toBe(1);
    expect(handle?.getComments()).toHaveLength(1);
    // the popover offers no write controls on a read-only grid
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()?.querySelector("textarea")).toBeNull();
    expect(page.getByRole("button", { name: /^(Edit|Delete|Resolve|Reopen) comment/ }).elements()).toHaveLength(0);
    expect(reasons).toEqual([]);
  });
});

describe("comments: focus inside the popover", () => {
  it("moves focus to Confirm when the delete confirmation opens and keeps it inside the popover after the delete", async () => {
    await render(<Harness options={{ defaultComments: [comment(), comment({ id: "c2", text: "Second" })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    await page.getByRole("button", { name: /^Delete comment by Alice/ }).first().click();
    await expect.poll(() => document.activeElement?.hasAttribute("data-comment-confirm")).toBe(true);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => handle?.getComments().length).toBe(1);
    await expect.poll(() => popup()?.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus inside the popover when the edit box closes and when a remote change removes the focused comment", async () => {
    await render(<Harness options={{ defaultComments: [comment(), comment({ id: "c2", text: "Second" })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    await page.getByRole("button", { name: /^Edit comment by Alice/ }).first().click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => popup()?.contains(document.activeElement)).toBe(true);
    (document.querySelector('button[aria-label^="Resolve comment"]') as HTMLElement).focus();
    handle?.applyRemote([{ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2, writeId: "zz" }]);
    handle?.applyRemote([{ kind: "delete", id: "c2", rowId: "r1", columnId: "name", version: 2, writeId: "zz" }]);
    await expect.poll(() => popup()?.contains(document.activeElement)).toBe(true);
  });
});
