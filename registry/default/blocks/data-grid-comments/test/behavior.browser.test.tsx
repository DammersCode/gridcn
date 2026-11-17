import axe from "axe-core";
import { useState } from "react";
import { cdp, page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type DataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridContextMenu } from "@/registry/default/blocks/data-grid-context-menu/data-grid-context-menu";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridComments } from "../data-grid-comments";
import type { CellComment, UseDataGridCommentsOptions, UseDataGridCommentsResult } from "../data-grid-comments";
import "@/app/global.css";

type Row = { id: string; name: string; status: string };

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}`, status: i % 2 ? "open" : "done" }));
const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 },
  { id: "status", header: "Status", accessorKey: "status", type: "text", width: 120 },
] as const);
const pinnedColumns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200, pin: "start" },
  { id: "status", header: "Status", accessorKey: "status", type: "text", width: 120 },
] as const);

const alice = { id: "alice", name: "Alice" };
const bob = { id: "bob", name: "Bob" };

function comment(overrides: Partial<CellComment> = {}): CellComment {
  return { id: "c1", rowId: "r1", columnId: "name", text: "Check this value", author: alice, createdAt: Date.UTC(2026, 0, 5, 10, 0), updatedAt: Date.UTC(2026, 0, 5, 10, 0), version: 1, writeId: "w0", resolved: false, ...overrides };
}

let handle: UseDataGridCommentsResult | undefined;
let gridApi: DataGridApi<Row> | undefined;

function ApiProbe() {
  gridApi = useDataGridApi<Row>();
  return null;
}

function Harness({ options = {}, withMenu = false, pinned = false, tag = "" }: { options?: UseDataGridCommentsOptions; withMenu?: boolean; pinned?: boolean; tag?: string }) {
  const comments = useDataGridComments({ currentUser: alice, ...options });
  if (!tag) handle = comments;
  const [data] = useState(rows);
  const grid = (
    <DataGridRoot className="h-[300px]" aria-label={`grid ${tag}`}>
      <DataGridHeader />
      <DataGridBody />
    </DataGridRoot>
  );
  return (
    <div style={{ height: 300 }}>
      <DataGridProvider data={data} columns={pinned ? pinnedColumns : columns} getRowId={(r) => r.id} plugins={[comments.plugin]}>
        {!tag && <ApiProbe />}
        {withMenu ? <DataGridContextMenu getCellMenuItems={comments.getCommentMenuItems}>{grid}</DataGridContextMenu> : grid}
      </DataGridProvider>
    </div>
  );
}

const markers = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(gridAttrSelector("commentMarker")));
const popup = (): HTMLElement | null => document.querySelector<HTMLElement>(gridAttrSelector("commentsPopup"));

afterEach(async () => {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
});

describe("comments: accessibility and focus", () => {
  it("has no axe violations with the grid, a marker, the announcer, and an open popover", async () => {
    await render(
      <main>
        <Harness options={{ defaultComments: [comment({ author: bob })] }} />
      </main>,
    );
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    const result = await axe.run({ include: [["body"]], exclude: [["[data-base-ui-focus-guard]"]] }, { rules: { region: { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.failureSummary).join(" | ")}`)).toEqual([]);
  });

  it("the popover is a non-modal dialog labelled with the column title and the cell text", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    await expect.poll(() => popup()?.getAttribute("aria-label")).toBe("Comments on Name: Item 0");
    expect(popup()?.getAttribute("role")).toBe("dialog");
  });

  it("a label set to undefined keeps its default, also a function label", async () => {
    await render(<Harness withMenu options={{ labels: { popover: undefined, menuItem: undefined, composer: undefined } }} />);
    await page.getByRole("gridcell").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Comments…" }).click();
    await expect.poll(() => popup()?.getAttribute("aria-label")).toBe("Comments on Name: Item 0");
    await expect.element(page.getByRole("textbox", { name: "Write a comment" })).toBeInTheDocument();
  });

  it("the popover sits under its cell and follows it when the grid scrolls", async () => {
    await render(<Harness />);
    const cell = page.getByRole("gridcell").nth(2);
    await cell.click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    const below = () => (popup() as HTMLElement).getBoundingClientRect().top - cell.element().getBoundingClientRect().bottom;
    await expect.poll(() => Math.abs(below() - 4) <= 2).toBe(true);
    const scroller = document.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
    scroller.scrollTop = 20;
    await expect.poll(() => Math.abs(below() - 4) <= 2).toBe(true);
  });

  it("Escape returns focus to the active cell when the keyboard opened the popover", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await expect.poll(() => document.activeElement?.closest('[role="grid"]') !== null).toBe(true);
  });

  it("Tab past the last control closes the popover and continues from the grid; Shift+Tab past the first control goes back", async () => {
    await render(
      <div>
        <button type="button">before</button>
        <Harness options={{ defaultComments: [comment({ author: bob })] }} />
        <button type="button">after</button>
      </div>,
    );
    await page.getByRole("gridcell").nth(2).click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    for (let i = 0; i < 6 && popup(); i += 1) await userEvent.keyboard("{Tab}");
    await expect.poll(() => popup()).toBeNull();
    await expect.element(page.getByRole("button", { name: "after" })).toHaveFocus();
    await page.getByRole("gridcell").nth(2).click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await expect.poll(() => popup()).toBeNull();
    await expect.element(page.getByRole("button", { name: "before" })).toHaveFocus();
  });

  it("an outside press closes the popover and the typed draft survives", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await userEvent.keyboard("keep me");
    await page.getByRole("gridcell").nth(6).click();
    await expect.poll(() => popup()).toBeNull();
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.element(page.getByRole("textbox", { name: "Write a comment" })).toHaveValue("keep me");
  });

  it("typing in the composer does not re-render the overlay", async () => {
    await render(<Harness options={{ defaultComments: [comment({ author: bob })] }} />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    const before = markers()[0];
    await userEvent.keyboard("abc");
    expect(markers()[0]).toBe(before);
  });
});

describe("comments: context menu and grids", () => {
  it("the context-menu item opens the popover after the menu closed", async () => {
    await render(<Harness withMenu />);
    await page.getByRole("gridcell").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Comments…" }).click();
    await expect.poll(() => popup()).not.toBeNull();
    await expect.element(page.getByRole("textbox", { name: "Write a comment" })).toBeInTheDocument();
  });

  it("two grids on one page do not cross-talk", async () => {
    await render(
      <div>
        <Harness options={{ defaultComments: [comment({ author: bob })] }} />
        <Harness tag="other" />
      </div>,
    );
    await expect.poll(() => markers().length).toBe(1);
    const grids = page.getByRole("grid").elements();
    expect(grids).toHaveLength(2);
    const otherCell = grids[1]?.querySelector<HTMLElement>('[role="gridcell"]');
    otherCell?.click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    expect(grids[0]?.contains(markers()[0] ?? null)).toBe(true);
    expect(popup()?.getAttribute("aria-label")).toBe("Comments on Name: Item 0");
    handle?.applyRemote([{ kind: "upsert", comment: comment({ id: "x", rowId: "r3", writeId: "wx", author: bob }) }]);
    await expect.poll(() => markers().length).toBe(2);
    expect(grids[1]?.querySelectorAll(gridAttrSelector("commentMarker")).length).toBe(0);
  });

  it("a marker in a pinned column sits inside its cell", async () => {
    await render(<Harness pinned options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    const marker = markers()[0] as HTMLElement;
    const cell = document.querySelector<HTMLElement>('[role="row"][aria-rowindex="3"] [role="gridcell"][aria-colindex="1"]') as HTMLElement;
    const m = marker.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    expect(m.right).toBeLessThanOrEqual(c.right + 1);
    expect(m.top).toBeGreaterThanOrEqual(c.top - 1);
    expect(m.top).toBeLessThanOrEqual(c.top + 12);
  });

  it("an unpinned marker stays out of the rows canvas flow, so it never re-lays out the rows", async () => {
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    const holder = markers()[0]?.parentElement as HTMLElement;
    expect(getComputedStyle(holder).position).toBe("absolute");
    const cell = document.querySelector<HTMLElement>('[role="row"][aria-rowindex="3"] [role="gridcell"][aria-colindex="1"]') as HTMLElement;
    const m = (markers()[0] as HTMLElement).getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    expect(Math.abs(m.right - c.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.top - c.top)).toBeLessThanOrEqual(1);
  });

  it("a pinned column covers the marker of an unpinned cell scrolled under it", async () => {
    type Wide = { id: string; name: string; a: string; b: string; c: string; d: string };
    const wideColumns = defineColumns<Wide>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200, pin: "start" },
      { id: "a", header: "A", accessorKey: "a", type: "text", width: 200 },
      { id: "b", header: "B", accessorKey: "b", type: "text", width: 200 },
      { id: "c", header: "C", accessorKey: "c", type: "text", width: 200 },
      { id: "d", header: "D", accessorKey: "d", type: "text", width: 200 },
    ] as const);
    const wideRows: Wide[] = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, a: "a", b: "b", c: "c", d: "d" }));
    function Wide() {
      const comments = useDataGridComments({ currentUser: alice, defaultComments: [comment({ columnId: "a" })] });
      return (
        <div style={{ height: 300, width: 500 }}>
          <DataGridProvider data={wideRows} columns={wideColumns} getRowId={(r) => r.id} plugins={[comments.plugin]}>
            <DataGridRoot className="h-[300px] w-[500px]">
              <DataGridHeader />
              <DataGridBody />
            </DataGridRoot>
          </DataGridProvider>
        </div>
      );
    }
    await render(<Wide />);
    await expect.poll(() => markers().length).toBe(1);
    const scroller = document.querySelector<HTMLElement>('[role="grid"]') as HTMLElement;
    scroller.scrollLeft = 250;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const m = (markers()[0] as HTMLElement).getBoundingClientRect();
    const pinnedCell = document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="1"]') as HTMLElement;
    expect(m.right).toBeLessThan(pinnedCell.getBoundingClientRect().right);
    const top = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
    expect(top?.closest(gridAttrSelector("commentMarker"))).toBeNull();
  });

  it("a touch context menu inside the popover keeps the native menu of its text field", async () => {
    await render(<Harness withMenu />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    const field = page.getByRole("textbox", { name: "Write a comment" });
    await expect.element(field).toBeInTheDocument();
    const event = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType: "touch" });
    field.element().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("comments: conflicts and retries", () => {
  it("a stale rejection shows the conflict UI with Save my version and Discard", async () => {
    const current = comment({ version: 2, text: "Someone else changed it", writeId: "w-other" });
    await render(
      <Harness
        options={{
          defaultComments: [comment()],
          onCommentSave: () => ({ rejected: { reason: "stale", current } }),
        }}
      />,
    );
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    await page.getByRole("button", { name: /^Edit comment by Alice/ }).click();
    await userEvent.keyboard("{Control>}a{/Control}My version");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.element(page.getByText("Changed by someone else")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Save my version" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect.element(page.getByText("Changed by someone else")).not.toBeInTheDocument();
  });

  it("a thrown save keeps the draft and Retry resubmits", async () => {
    let calls = 0;
    await render(
      <Harness
        options={{
          defaultComments: [comment()],
          onCommentSave: () => {
            calls += 1;
            if (calls === 1) throw new Error("offline");
          },
        }}
      />,
    );
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await page.getByRole("button", { name: /^Edit comment by Alice/ }).click();
    await userEvent.keyboard("{Control>}a{/Control}Retry me");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.element(page.getByText("The comment could not be saved.")).toBeInTheDocument();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.poll(() => handle?.getComments()[0]?.text).toBe("Retry me");
    expect(calls).toBe(2);
  });

  it("a gate refusal shows an inline message", async () => {
    await render(<Harness options={{ canCreate: () => false }} />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await userEvent.keyboard("nope{Control>}{Enter}{/Control}");
    await expect.element(page.getByText("You cannot do this.")).toBeInTheDocument();
    expect(handle?.getComments()).toHaveLength(0);
  });
});

describe("comments: imperative API", () => {
  it("openComments returns false for an unknown row and a hidden column, true for a rendered cell", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(handle?.openComments({ rowId: "nope", columnId: "name" })).toBe(false);
    expect(handle?.openComments({ rowId: "r1", columnId: "nope" })).toBe(false);
    expect(handle?.openComments({ rowId: "r1", columnId: "name" })).toBe(true);
    await expect.poll(() => popup()).not.toBeNull();
    handle?.closeComments();
    await expect.poll(() => popup()).toBeNull();
  });

  it("removeComments drops the markers and closes an open popover of that row", async () => {
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(handle?.removeComments({ rowIds: ["r1"] })).toBe(1);
    await expect.poll(() => markers().length).toBe(0);
    await expect.poll(() => popup()).toBeNull();
  });

  it("an id swap re-keys the marker to the new row id", async () => {
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    gridApi?.actions.replaceRowId("r1", { id: "server-1", name: "Item 1", status: "open" });
    await expect.poll(() => handle?.getComments()[0]?.rowId).toBe("server-1");
    await expect.poll(() => markers().length).toBe(1);
  });

  it("fetchComments loads the rendered rows and shows the Loading state in the popover first", async () => {
    let release: (value: CellComment[]) => void = () => {};
    let requested = false;
    await render(
      <Harness
        options={{
          fetchComments: () =>
            new Promise<CellComment[]>((resolve) => {
              requested = true;
              release = resolve;
            }),
        }}
      />,
    );
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.element(page.getByText("Loading comments…")).toBeInTheDocument();
    await expect.poll(() => requested).toBe(true);
    release([comment({ rowId: "r0", id: "f0", writeId: "wf" })]);
    await expect.poll(() => markers().length).toBe(1);
    await expect.element(page.getByText("Loading comments…")).not.toBeInTheDocument();
  });
});

describe("comments: touch", () => {
  it("grows the marker hit area to 24 px under a coarse pointer without growing the drawn corner", async () => {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    const marker = markers()[0] as HTMLElement;
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
    expect(marker.getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
    const drawn = marker.firstElementChild as HTMLElement;
    expect(drawn.getBoundingClientRect().width).toBeLessThanOrEqual(9);
  });
});
