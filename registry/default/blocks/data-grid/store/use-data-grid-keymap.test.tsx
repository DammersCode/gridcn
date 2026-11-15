import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridKeymap, type ColumnDef, type Keymap } from "../data-grid";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [{ id: "r1", name: "a" }];

afterEach(cleanup);

function readKeymap(keymap: Keymap): Keymap {
  let seen: Keymap = {};
  function Probe() {
    seen = useDataGridKeymap();
    return null;
  }
  render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r: Row) => r.id} keymap={keymap}>
      <Probe />
    </DataGridProvider>,
  );
  return seen;
}

describe("useDataGridKeymap", () => {
  it("drops a binding with an unknown modifier", () => {
    expect(readKeymap({ undo: ["Mod+Z"] }).undo).toEqual([]);
  });

  it("drops a binding with an unknown key name", () => {
    const keymap = readKeymap({ clearContents: ["mod+delete"], selectAll: ["mod+Space"] });
    expect(keymap.clearContents).toEqual([]);
    expect(keymap.selectAll).toEqual([]);
  });

  it("drops a binding with no key", () => {
    expect(readKeymap({ undo: ["mod+"] }).undo).toEqual([]);
  });

  it("keeps the live bindings of an action next to a dead one", () => {
    expect(readKeymap({ clearContents: ["mod+delete", "mod+Delete", "Backspace"] }).clearContents).toEqual(["mod+Delete", "Backspace"]);
  });
});
