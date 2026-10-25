import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridSearch } from "@/registry/default/blocks/data-grid-toolbar/search";
import { useDataGridFindReplace } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, name: i % 10 === 5 ? `needle ${i}` : `item ${i}` }));
const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

function Harness({ readOnly = false, withToolbar = false, scope, replaceAllLimit, dir }: { readOnly?: boolean; withToolbar?: boolean; scope?: "view" | "selection"; replaceAllLimit?: number; dir?: "ltr" | "rtl" } = {}) {
  const findReplace = useDataGridFindReplace({ scope, replaceAllLimit });
  return (
    <div style={{ height: 400 }} dir={dir}>
      <button type="button" onClick={() => findReplace.open()}>
        Open find
      </button>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]} readOnly={readOnly}>
        {withToolbar && <DataGridSearch />}
        <DataGridRoot className="h-[400px]" direction={dir}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

describe("find and replace in a browser", () => {
  it("Ctrl+H opens the panel with focus in Find, and Escape returns focus to the grid", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect.element(find).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement?.closest('[role="grid"]')).not.toBeNull();
  });

  it("Enter in Find moves the active cell to the next match", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    await userEvent.keyboard("needle");
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3 cells");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("2 of 3 cells");
  });

  it("Escape leaves focus alone when the panel was not opened from the grid", async () => {
    await render(<Harness />);
    await page.getByRole("button", { name: "Open find" }).click();
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement?.closest('[role="grid"]')).toBeNull();
  });

  it("Ctrl+F with the grid focused opens Find only, without a Replace field", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).toHaveAttribute("aria-expanded", "false");
  });

  it("the chevron toggles the Replace row", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    const toggle = page.getByRole("button", { name: "Toggle replace" });
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();
    await toggle.click();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
  });

  it("Ctrl+H opens expanded", async () => {
    await render(<Harness />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}h{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).toHaveAttribute("aria-expanded", "true");
  });

  it("Ctrl+F outside the grid does not open the panel", async () => {
    await render(<Harness />);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    outside.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    outside.remove();
  });

  it("a read-only grid has no toggle and no Replace field", async () => {
    await render(<Harness readOnly />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await expect.element(page.getByRole("button", { name: "Toggle replace" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("textbox", { name: "Replace with" })).not.toBeInTheDocument();
  });

  it("Find text shows in the toolbar search and focus stays in the panel", async () => {
    await render(<Harness withToolbar />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    await userEvent.keyboard("needle");
    await expect.element(page.getByLabelText("Search grid")).toHaveValue("needle");
    await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
  });

  it("Ctrl+F seeds Find from the toolbar search and both fields follow each other", async () => {
    await render(<Harness withToolbar />);
    const toolbar = page.getByLabelText("Search grid");
    await toolbar.fill("needle");
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Control>}f{/Control}");
    const find = page.getByRole("textbox", { name: "Find" });
    await expect.element(find).toHaveValue("needle");
    await expect.element(find).toHaveFocus();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3 cells");
    await toolbar.fill("item 1");
    await expect.element(find).toHaveValue("item 1");
    await find.fill("item 2");
    await expect.element(toolbar).toHaveValue("item 2");
  });

  it("clicking Replace all keeps the cell range, so scope selection replaces only inside it", async () => {
    await render(<Harness scope="selection" />);
    const cells = page.getByRole("gridcell");
    await cells.nth(1).click();
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    await userEvent.keyboard("{Control>}h{/Control}");
    await userEvent.keyboard("item");
    await page.getByRole("textbox", { name: "Replace with" }).fill("x");
    await page.getByRole("button", { name: "Replace all" }).click();
    const texts = Array.from(document.querySelectorAll('[role="gridcell"]')).map((c) => c.textContent);
    expect(texts.slice(0, 5)).toEqual(["item 0", "x 1", "x 2", "x 3", "item 4"]);
  });

  describe("panel layout", () => {
    const panel = () => document.querySelector('[role="dialog"]') as HTMLElement;
    const statusLine = () => panel().querySelector('[role="status"]') as HTMLElement;

    async function openPanel(chord = "f") {
      await page.getByRole("gridcell").first().click();
      await userEvent.keyboard(`{Control>}${chord}{/Control}`);
      await expect.element(page.getByRole("textbox", { name: "Find" })).toHaveFocus();
    }

    it("keeps the status line outside the Find field", async () => {
      await render(<Harness />);
      await openPanel();
      await userEvent.keyboard("needle");
      await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3 cells");
      const field = panel().querySelector("[data-find-field]") as HTMLElement;
      expect(field.contains(statusLine())).toBe(false);
      expect(field.contains(page.getByRole("textbox", { name: "Find" }).element())).toBe(true);
      expect(field.contains(page.getByRole("button", { name: "Match case" }).element())).toBe(true);
      expect(field.contains(page.getByRole("button", { name: "Whole cell" }).element())).toBe(true);
    });

    it("shows Type to search, a count, and No results in the status line", async () => {
      await render(<Harness />);
      await openPanel();
      const status = page.getByRole("dialog").getByRole("status");
      await expect.element(status).toHaveTextContent("Type to search");
      expect(statusLine().getAttribute("aria-live")).toBe("polite");
      await userEvent.keyboard("needle");
      await expect.element(status).toHaveTextContent("1 of 3 cells");
      await userEvent.keyboard("zzz");
      await expect.element(status).toHaveTextContent("No results");
      expect(statusLine().className).toContain("text-destructive");
    });

    it("titles the previous and next buttons with their keys", async () => {
      await render(<Harness />);
      await openPanel();
      await expect.element(page.getByRole("button", { name: "Next match" })).toHaveAttribute("title", "Next match (Enter)");
      await expect.element(page.getByRole("button", { name: "Previous match" })).toHaveAttribute("title", "Previous match (Shift+Enter)");
    });

    it("marks a pressed option toggle with aria-pressed and the on state", async () => {
      await render(<Harness />);
      await openPanel();
      const matchCase = page.getByRole("button", { name: "Match case" });
      await expect.element(matchCase).toHaveAttribute("aria-pressed", "false");
      await expect.element(matchCase).toHaveAttribute("data-state", "off");
      await matchCase.click();
      await expect.element(matchCase).toHaveAttribute("aria-pressed", "true");
      await expect.element(matchCase).toHaveAttribute("data-state", "on");
      expect(matchCase.element().className).toContain("bg-primary");
      expect(matchCase.element().querySelector("span.rounded-full")).toBeNull();
      await expect.element(page.getByRole("button", { name: "Whole cell" })).toHaveAttribute("data-state", "off");
    });

    it("keeps the panel height across empty, matching, and no-result states", async () => {
      await render(<Harness />);
      await openPanel("h");
      const empty = panel().getBoundingClientRect().height;
      await userEvent.keyboard("needle");
      await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3 cells");
      const matching = panel().getBoundingClientRect().height;
      await userEvent.keyboard("zzz");
      await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("No results");
      const none = panel().getBoundingClientRect().height;
      expect(matching).toBe(empty);
      expect(none).toBe(empty);
    });

    it("keeps the panel height and the full text in the title when a replace leaves more matches", async () => {
      await render(<Harness replaceAllLimit={1} />);
      await openPanel("h");
      const empty = panel().getBoundingClientRect().height;
      await userEvent.keyboard("needle");
      await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 3 cells");
      await page.getByRole("textbox", { name: "Replace with" }).fill("x");
      await page.getByRole("button", { name: "Replace all", exact: true }).click();
      await expect.poll(() => statusLine().textContent).toContain("More matches remain");
      expect(panel().getBoundingClientRect().height).toBe(empty);
      expect(statusLine().getAttribute("title")).toContain("More matches remain");
    });

    it("sizes its buttons to at least 32px", async () => {
      await render(<Harness />);
      await openPanel("h");
      for (const name of ["Toggle replace", "Match case", "Whole cell", "Next match", "Previous match", "Close", "Replace", "Replace all"]) {
        expect(page.getByRole("button", { name, exact: true }).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
      }
    });

    it("fits a 375px viewport", async () => {
      await page.viewport(375, 800);
      try {
        await render(<Harness />);
        await openPanel("h");
        const rect = panel().getBoundingClientRect();
        expect(rect.left).toBeGreaterThanOrEqual(0);
        expect(rect.right).toBeLessThanOrEqual(375);
        expect(panel().scrollWidth).toBeLessThanOrEqual(panel().clientWidth);
      } finally {
        await page.viewport(1024, 768);
      }
    });
  });
});

describe("find and replace panel follows the grid direction, not the page's", () => {
  async function dock(pageDir: "ltr" | "rtl", gridDir: "ltr" | "rtl") {
    document.documentElement.dir = pageDir;
    try {
      await render(<Harness dir={gridDir} />);
      await page.getByRole("gridcell").first().click();
      await userEvent.keyboard("{Control>}f{/Control}");
      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toBeInTheDocument();
      const panel = dialog.element().getBoundingClientRect();
      const grid = document.querySelector('[role="grid"]')!.getBoundingClientRect();
      return { fromLeft: panel.left - grid.left, fromRight: grid.right - panel.right };
    } finally {
      document.documentElement.dir = "";
    }
  }

  it("docks to the left edge for an rtl grid on an ltr page", async () => {
    const { fromLeft, fromRight } = await dock("ltr", "rtl");
    expect(fromLeft).toBeLessThan(fromRight);
  });

  it("docks to the right edge for an ltr grid on an rtl page", async () => {
    const { fromLeft, fromRight } = await dock("rtl", "ltr");
    expect(fromRight).toBeLessThan(fromLeft);
  });
});
