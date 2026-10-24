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
  type Keymap,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace } from "@/registry/default/blocks/data-grid-find-replace/use-data-grid-find-replace";
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

  it("lists a custom command with its label and group", async () => {
    // a real consumer augments GridActions via declaration merging; the repo's tsc program can't
    // host that (it would break the exhaustive GridAction test), so the demo binding is asserted
    const keymap = { saveRow: ["mod+s"] } as Keymap;
    await render(
      <DataGridProvider
        data={ROWS}
        columns={columns}
        getRowId={(r) => r.id}
        commands={{ saveRow: { label: "Save row", group: "editing", run: () => {} } }}
        keymap={keymap}
      >
        <DataGridKeybindingsDialog open />
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    const row = document.querySelector('[data-keybindings-action="saveRow"]');
    expect(row?.textContent).toContain("Save row");
    expect(row?.textContent).toContain("S");
    expect(row?.closest('[data-keybindings-category="editing"]')).not.toBeNull();
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

function FindReplaceDialog({ keymap }: { keymap?: Keymap }) {
  const findReplace = useDataGridFindReplace();
  return (
    <DataGridProvider data={ROWS} columns={columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]} keymap={keymap}>
      <DataGridKeybindingsDialog open />
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

function chipLabels(action: string): string[] {
  const row = document.querySelector(`[data-keybindings-action="${action}"]`);
  return [...(row?.querySelectorAll("kbd") ?? [])].map((k) => k.textContent ?? "");
}

describe("find-replace plugin bindings in the dialog", () => {
  it("lists Find and Find and replace with their chips under the selection category", async () => {
    await render(<FindReplaceDialog />);
    await expect.element(page.getByRole("dialog")).toBeInTheDocument();

    const find = document.querySelector('[data-keybindings-action="openFind"]');
    const replace = document.querySelector('[data-keybindings-action="openFindReplace"]');
    expect(find?.textContent).toContain("Find");
    expect(find?.textContent).not.toContain("Open find");
    expect(replace?.textContent).toContain("Find and replace");
    expect(chipLabels("openFind")).toContain("F");
    expect(chipLabels("openFindReplace")).toContain("H");
    expect(find?.closest('[data-keybindings-category="selection"]')).not.toBeNull();
    expect(replace?.closest('[data-keybindings-category="selection"]')).not.toBeNull();
    expect(document.querySelector('[data-keybindings-category="other"]')).toBeNull();
  });

  it("reflects keymap overrides for a core action and a plugin action", async () => {
    await render(<FindReplaceDialog keymap={{ redo: ["mod+u"], openFind: ["mod+shift+f"] }} />);
    await expect.element(page.getByRole("dialog")).toBeInTheDocument();

    expect(chipLabels("redo")).toContain("U");
    expect(chipLabels("redo")).not.toContain("Y");
    const findChips = chipLabels("openFind");
    expect(findChips).toContain("F");
    expect(findChips.length).toBe(3);
  });
});
