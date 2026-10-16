import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; site: string; notes: string };

const rows: Row[] = [
  { id: "r0", site: "https://example.com/a", notes: "hello\nworld" },
  { id: "r1", site: "javascript:alert(1)", notes: "plain" },
  { id: "r2", site: "mailto:user@example.com", notes: "x" },
];

const columns = defineColumns<Row>()([
  { id: "site", header: "Site", accessorKey: "site", type: "url", width: 240 },
  { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 160 },
] as const);

async function renderGrid() {
  await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[240px] w-[420px]" />);
}

const linkLocator = () => page.getByRole("link", { name: "https://example.com/a" });

describe("url cell type (browser)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders safe values as safe links and unsafe values as plain text", async () => {
    await renderGrid();
    const link = linkLocator();
    await expect.element(link).toHaveAttribute("href", "https://example.com/a");
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect.element(link).toHaveAttribute("referrerPolicy", "no-referrer");
    const anchor = link.element() as HTMLAnchorElement;
    expect(anchor.getAttribute("tabindex")).toBe("-1");
    expect(anchor.draggable).toBe(false);

    await expect.element(page.getByRole("gridcell", { name: "javascript:alert(1)" })).toBeInTheDocument();
    expect(document.querySelector("a[href^='javascript:']")).toBeNull();
  });

  it("a plain click on the link selects the cell and opens nothing", async () => {
    await renderGrid();
    const link = linkLocator();
    const open = vi.spyOn(window, "open");
    await link.click();

    await expect.poll(() => document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBe(1);
    expect(document.querySelector('a[href="https://example.com/a"]')!.closest('[role="gridcell"]')?.getAttribute("aria-selected")).toBe("true");
    expect(open).not.toHaveBeenCalled();
  });

  it("ctrl+click on the link opens it in a new tab without an opener and selects the cell", async () => {
    await renderGrid();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.keyboard("{Control>}");
    await linkLocator().click();
    await userEvent.keyboard("{/Control}");

    expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com/a", "_blank", "noopener,noreferrer");
    await expect.poll(() => document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBe(1);
  });

  it("ctrl+click on a second link opens that cell's link, not the previous active cell's", async () => {
    await renderGrid();
    await page.getByRole("gridcell", { name: "plain" }).click();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.keyboard("{Control>}");
    await page.getByRole("link", { name: "mailto:user@example.com" }).click();
    await userEvent.keyboard("{/Control}");

    expect(open).toHaveBeenCalledExactlyOnceWith("mailto:user@example.com", "_blank", "noopener,noreferrer");
  });

  it("a middle press on the link is left to the browser: no selection, default not prevented", async () => {
    await renderGrid();
    const anchor = linkLocator().element();
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 1, pointerId: 7 });
    anchor.dispatchEvent(press);

    expect(press.defaultPrevented).toBe(false);
    expect(document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBe(0);
  });

  it("dragging from a link extends a range instead of a native link drag", async () => {
    await renderGrid();
    // (0,0) to (1,1) extends the whole 2x2 block: four selected cells, no native link drag
    await userEvent.dragAndDrop(linkLocator(), page.getByRole("gridcell", { name: "plain" }));
    await expect.poll(() => document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBe(4);
  });

  it("ctrl+dragging from a link to another cell selects the range and opens nothing", async () => {
    await renderGrid();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await userEvent.keyboard("{Control>}");
    await userEvent.dragAndDrop(linkLocator(), page.getByRole("gridcell", { name: "plain" }));
    await userEvent.keyboard("{/Control}");
    await expect.poll(() => document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length).toBeGreaterThan(1);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("longText cell type (browser)", () => {
  it("Enter commits and moves down, Shift+Enter and Alt+Enter insert a break, Escape cancels", async () => {
    await renderGrid();
    await page.getByRole("gridcell", { name: "hello world" }).click();
    await userEvent.keyboard("{F2}");

    const textarea = page.getByRole("textbox", { name: "Notes" });
    await expect.element(textarea).toBeVisible();
    await userEvent.keyboard("{shift>}{enter}{/shift}");
    expect((textarea.element() as HTMLTextAreaElement).value).toBe("hello\nworld\n");

    await userEvent.keyboard("{alt>}{enter}{/alt}");
    expect((textarea.element() as HTMLTextAreaElement).value).toBe("hello\nworld\n\n");

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("gridcell", { name: "hello world" })).toBeInTheDocument();
    await expect.element(page.getByRole("textbox", { name: "Notes" })).not.toBeInTheDocument();

    // reopen and commit: the edited value lands, the active cell moves down
    await userEvent.keyboard("{F2}");
    const reopened = page.getByRole("textbox", { name: "Notes" });
    await userEvent.type(reopened, " edited");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("gridcell", { name: "hello world edited" })).toBeInTheDocument();
    await expect.poll(() => document.querySelector('[role="gridcell"][aria-selected="true"]')?.textContent).toContain("plain");
  });

  it("closing the popover with an outside press commits the draft", async () => {
    // a focusable target OUTSIDE the React tree: Base UI treats clicks on the React render root as "inside"
    const outside = document.createElement("button");
    outside.textContent = "outside";
    outside.style.cssText = "position:fixed;left:0;bottom:0;z-index:9999";
    document.body.appendChild(outside);

    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[240px] w-[420px]" />);
    await page.getByRole("gridcell", { name: "hello world" }).click();
    await userEvent.keyboard("{F2}");
    const textarea = page.getByRole("textbox", { name: "Notes" });
    await userEvent.type(textarea, "zzz");
    await userEvent.click(outside);
    await expect.element(page.getByRole("gridcell", { name: "hello worldzzz" })).toBeInTheDocument();
    outside.remove();
  });
});

describe("longText maxLength (browser)", () => {
  it("rejects input longer than the column's maxLength", async () => {
    const smallColumns = defineColumns<Row>()([
      { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 200, options: { maxLength: 8 } },
    ] as const);
    await render(<DataGrid data={[rows[0]!]} columns={smallColumns} getRowId={(r) => r.id} className="h-[160px] w-[300px]" />);

    await page.getByRole("gridcell", { name: "hello world" }).click();
    await userEvent.keyboard("{F2}");
    const textarea = page.getByRole("textbox", { name: "Notes" });
    await expect.element(textarea).toBeVisible();
    // the textarea's maxLength attribute clamps typing: 9 chars land, only 8 fit
    await userEvent.clear(textarea);
    await userEvent.keyboard("123456789");
    expect((textarea.element() as HTMLTextAreaElement).value).toHaveLength(8);
  });
});
