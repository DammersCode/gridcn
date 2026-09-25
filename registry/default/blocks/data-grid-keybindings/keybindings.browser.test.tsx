import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridKeybindingsDialog } from "./keybindings-dialog";
import { DataGridKeybindingsShortcut } from "./keybindings-shortcut";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 }] as const);

const ROWS: Row[] = [
  { id: "r0", name: "Alice" },
  { id: "r1", name: "Bob" },
];

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <DataGridProvider data={ROWS} columns={columns} getRowId={(r) => r.id}>
      <DataGridKeybindingsDialog open={open} onOpenChange={setOpen} />
      <DataGridRoot className="h-[300px]">
        <DataGridKeybindingsShortcut onOpen={() => setOpen(true)} />
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

function gridCell(rowText: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')].find((c) => c.textContent?.includes(rowText))!;
}

describe("DataGridKeybindingsShortcut + DataGridKeybindingsDialog", () => {
  it("'?' opens the dialog while the grid container has focus", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(gridCell("Alice"));
    await userEvent.keyboard("?");

    await expect.element(page.getByRole("dialog")).toBeInTheDocument();
    await expect.element(page.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("'?' does not leak into the grid's type-to-edit fallback and overwrite the active cell", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(gridCell("Alice"));
    await userEvent.keyboard("?");

    await expect.element(page.getByRole("dialog")).toBeInTheDocument();
    expect(gridCell("Alice").textContent).toContain("Alice");
    await expect.element(page.getByRole("gridcell", { name: "?" })).not.toBeInTheDocument();
  });

  it("lists a known keymap binding (Undo: mod Z) and the native Copy shortcut", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(gridCell("Alice"));
    await userEvent.keyboard("?");
    await expect.element(page.getByRole("dialog")).toBeInTheDocument();

    const undoRow = document.querySelector('[data-keybindings-action="undo"]');
    expect(undoRow?.textContent).toContain("Undo");
    expect(undoRow?.textContent).toContain("Z");

    const copyRow = document.querySelector('[data-keybindings-action="Copy"]');
    expect(copyRow?.textContent).toContain("Copy");
    expect(copyRow?.textContent).toContain("C");
  });

  it("Escape closes the dialog", async () => {
    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(gridCell("Alice"));
    await userEvent.keyboard("?");
    await expect.element(page.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
