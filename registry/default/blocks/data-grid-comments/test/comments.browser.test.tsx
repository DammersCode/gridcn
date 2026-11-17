import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridComments } from "../data-grid-comments";
import type { CellComment, UseDataGridCommentsOptions, UseDataGridCommentsResult } from "../data-grid-comments";
import "@/app/global.css";

type Row = { id: string; name: string; status: string };

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: `Item ${i}`, status: i % 2 ? "open" : "done" }));
const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 },
  { id: "status", header: "Status", accessorKey: "status", type: "text", width: 120 },
] as const);

const alice = { id: "alice", name: "Alice" };
const bob = { id: "bob", name: "Bob" };

function comment(overrides: Partial<CellComment> = {}): CellComment {
  return { id: "c1", rowId: "r1", columnId: "name", text: "Check this value", author: bob, createdAt: Date.UTC(2026, 0, 5, 10, 0), updatedAt: Date.UTC(2026, 0, 5, 10, 0), version: 1, resolved: false, ...overrides };
}

let handle: UseDataGridCommentsResult | undefined;

function Harness({ options = {}, readOnly = false, dir }: { options?: UseDataGridCommentsOptions; readOnly?: boolean; dir?: "ltr" | "rtl" }) {
  const comments = useDataGridComments({ currentUser: alice, ...options });
  handle = comments;
  const [data] = useState(rows);
  return (
    <div style={{ height: 400 }} dir={dir}>
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} plugins={[comments.plugin]} readOnly={readOnly}>
        <DataGridRoot className="h-[400px]" direction={dir}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

const markers = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(gridAttrSelector("commentMarker")));
const popup = (): HTMLElement | null => document.querySelector<HTMLElement>(gridAttrSelector("commentsPopup"));

describe("comments: markers", () => {
  it("paints one aria-hidden marker per commented cell, filled while unresolved and a ring when resolved only", async () => {
    await render(<Harness options={{ defaultComments: [comment(), comment({ id: "c2", rowId: "r2", resolved: true })] }} />);
    await expect.poll(() => markers().length).toBe(2);
    const [first, second] = markers();
    expect(first?.getAttribute("aria-hidden")).toBe("true");
    expect(first?.hasAttribute("data-unresolved")).toBe(true);
    expect(second?.hasAttribute("data-unresolved")).toBe(false);
  });

  it("hideResolved hides the marker of a resolved-only cell", async () => {
    await render(<Harness options={{ hideResolved: true, defaultComments: [comment({ resolved: true })] }} />);
    await new Promise((r) => setTimeout(r, 100));
    expect(markers()).toHaveLength(0);
  });

  it("a marker click opens the popover for that cell and lists the comment as text", async () => {
    await render(<Harness options={{ defaultComments: [comment({ text: "<b>bold</b> & more" })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()?.textContent).toContain("<b>bold</b> & more");
    expect(popup()?.querySelector("b")).toBeNull();
    expect(popup()?.getAttribute("aria-label")).toContain("Name");
  });
});

describe("comments: keyboard", () => {
  it("Shift+F2 opens the composer for the active cell and Mod+Enter creates a comment", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    const composer = page.getByRole("textbox", { name: "Write a comment" });
    await expect.element(composer).toHaveFocus();
    await userEvent.keyboard("First note{Control>}{Enter}{/Control}");
    await expect.poll(() => handle?.getComments().length).toBe(1);
    expect(handle?.getComments()[0]?.text).toBe("First note");
    await expect.poll(() => markers().length).toBe(1);
    await expect.element(page.getByRole("list", { name: "Comments" })).toBeInTheDocument();
  });

  it("Escape closes the popover and keeps the draft for the next open", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await userEvent.keyboard("half written");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => popup()).toBeNull();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.element(page.getByRole("textbox", { name: "Write a comment" })).toHaveValue("half written");
  });

  it("Shift+F2 does nothing on a hole-free grid without an active cell", async () => {
    await render(<Harness />);
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    expect(popup()).toBeNull();
  });

  it("opens read-only without currentUser and shows a hint instead of the composer", async () => {
    await render(<Harness options={{ currentUser: undefined, defaultComments: [comment()] }} />);
    await page.getByRole("gridcell").nth(2).click();
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()?.querySelector("textarea")).toBeNull();
    expect(popup()?.textContent).toContain("Sign in to comment.");
  });

  it("a read-only grid blocks writes unless allowWhenReadOnly", async () => {
    await render(<Harness readOnly options={{ defaultComments: [comment({ author: alice })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(popup()?.querySelector("textarea")).toBeNull();
    expect(popup()?.textContent).toContain("read-only");
  });
});

describe("comments: actions", () => {
  it("edit saves a new version, resolve and reopen toggle, delete confirms inline", async () => {
    await render(<Harness options={{ defaultComments: [comment({ author: alice })] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    await page.getByRole("button", { name: /^Edit comment by Alice/ }).click();
    await userEvent.keyboard("{Control>}a{/Control}Edited text");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => handle?.getComments()[0]?.text).toBe("Edited text");
    expect(handle?.getComments()[0]?.version).toBe(2);
    await page.getByRole("button", { name: /^Resolve comment by Alice/ }).click();
    await expect.poll(() => handle?.getComments()[0]?.resolved).toBe(true);
    await page.getByRole("button", { name: /^Reopen comment by Alice/ }).click();
    await expect.poll(() => handle?.getComments()[0]?.resolved).toBe(false);
    await page.getByRole("button", { name: /^Delete comment by Alice/ }).click();
    expect(handle?.getComments()).toHaveLength(1);
    await page.getByRole("button", { name: /^Confirm delete of comment by Alice/ }).click();
    await expect.poll(() => handle?.getComments().length).toBe(0);
  });

  it("another author's comment shows no Edit or Delete by default", async () => {
    await render(<Harness options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    markers()[0]?.click();
    await expect.poll(() => popup()).not.toBeNull();
    expect(page.getByRole("button", { name: /^Edit comment/ }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /^Resolve comment/ }).elements()).toHaveLength(1);
  });
});

describe("comments: remote", () => {
  it("applyRemote adds a marker and announces an addition to the open popover", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{F2}{/Shift}");
    await expect.poll(() => popup()).not.toBeNull();
    handle?.applyRemote([{ kind: "upsert", comment: comment({ rowId: "r0", id: "remote-1", writeId: "w" }) }]);
    await expect.poll(() => markers().length).toBe(1);
    await expect.poll(() => document.querySelector("[data-grid-comments-announcer]")?.textContent).toContain("Comment added by Bob");
  });
});

describe("comments: rtl", () => {
  it("places the marker at the inline-end corner", async () => {
    await render(<Harness dir="rtl" options={{ defaultComments: [comment()] }} />);
    await expect.poll(() => markers().length).toBe(1);
    const marker = markers()[0] as HTMLElement;
    const cell = marker.closest("[data-grid-comment-marker-cell]") as HTMLElement;
    const m = marker.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    expect(Math.abs(m.left - c.left)).toBeLessThan(2);
  });
});
