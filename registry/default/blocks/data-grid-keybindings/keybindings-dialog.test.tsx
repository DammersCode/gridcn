import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, DataGridRoot, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridKeybindingsDialog } from "./keybindings-dialog";
import { ACTION_CATEGORY } from "./action-groups";
import { DEFAULT_KEYMAP } from "@/registry/default/blocks/data-grid/keyboard";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [{ id: "r1", name: "a" }];

afterEach(cleanup);

function listedActions(extra: Record<string, unknown> = {}): (string | null)[] {
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id} {...extra}>
      <DataGridKeybindingsDialog defaultOpen />
      <DataGridRoot />
    </DataGridProvider>,
  );
  const dialog = screen.getByRole("dialog");
  return Array.from(dialog.querySelectorAll("[data-keybindings-action]")).map((el) => el.getAttribute("data-keybindings-action"));
}

describe("DataGridKeybindingsDialog", () => {
  it("leaves out actions that do nothing without their add-on or factory", () => {
    const actions = listedActions();
    for (const hollow of ["fillDown", "fillRight", "undo", "redo", "openFind", "insertRowBelow", "insertRowAbove", "duplicateRow"]) expect(actions).not.toContain(hollow);
    expect(actions).toContain("moveUp");
  });

  it("lists row actions once the grid has the factories", () => {
    const actions = listedActions({ createRow: () => ({ id: "n", name: "" }), duplicateRow: (row: Row) => ({ ...row, id: "d" }) });
    expect(actions).toEqual(expect.arrayContaining(["insertRowBelow", "insertRowAbove", "duplicateRow"]));
  });

  it("merges className into the dialog content", () => {
    render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id}>
        <DataGridKeybindingsDialog defaultOpen className="uppercase" />
        <DataGridRoot />
      </DataGridProvider>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("uppercase");
    expect(dialog).toHaveClass("overflow-y-auto");
  });

  it("lists an action that a command wires", () => {
    const actions = listedActions({ commands: { undo: { label: "Undo", run: () => {} } }, keymap: { undo: ["mod+z"] } });
    expect(actions).toContain("undo");
  });

  it("lists the native copy, cut, and paste rows in the clipboard group and no keymap action there", () => {
    const actions = listedActions();
    expect(actions).toEqual(expect.arrayContaining(["Copy", "Cut", "Paste"]));
    const clipboardActions = Object.entries(ACTION_CATEGORY).filter(([, category]) => category === "clipboardFill").map(([action]) => action);
    expect(clipboardActions.sort()).toEqual(["fillDown", "fillRight"]);
    for (const action of clipboardActions) expect(actions).not.toContain(action);
    expect(Object.keys(DEFAULT_KEYMAP).filter((action) => !(action in ACTION_CATEGORY))).toEqual([]);
  });
});
