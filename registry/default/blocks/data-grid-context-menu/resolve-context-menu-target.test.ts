import { describe, expect, it } from "vitest";
import { resolveContextMenuTarget } from "./resolve-context-menu-target";

describe("resolveContextMenuTarget", () => {
  it("returns null for a non-Element target", () => {
    expect(resolveContextMenuTarget(null)).toBeNull();
  });

  it("resolves a header cell to a header target (0-based col from aria-colindex)", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "columnheader");
    el.setAttribute("aria-colindex", "3");
    el.setAttribute("data-column-id", "age");
    document.body.appendChild(el);
    expect(resolveContextMenuTarget(el)).toEqual({ kind: "header", col: 2, columnId: "age" });
    document.body.removeChild(el);
  });

  it("returns null for a header cell missing aria-colindex or data-column-id", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "columnheader");
    document.body.appendChild(el);
    expect(resolveContextMenuTarget(el)).toBeNull();
    document.body.removeChild(el);
  });

  it("resolves a data gridcell to a cell target, deriving row from data-grid-row-index", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="4" data-grid-row-index="2">
        <div role="gridcell" aria-colindex="2" data-column-id="age">30</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toEqual({ kind: "cell", row: 2, col: 1, columnId: "age" });
    document.body.removeChild(container);
  });

  it("falls back to aria-rowindex - 2 when data-grid-row-index is absent (no pinned-top rows)", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="4">
        <div role="gridcell" aria-colindex="2" data-column-id="age">30</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toEqual({ kind: "cell", row: 2, col: 1, columnId: "age" });
    document.body.removeChild(container);
  });

  it("resolves the correct view row via data-grid-row-index with 1 pinned-top row (aria-rowindex is offset but ignored)", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="3" data-grid-row-index="0">
        <div role="gridcell" aria-colindex="1" data-column-id="name">Ada</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toEqual({ kind: "cell", row: 0, col: 0, columnId: "name" });
    document.body.removeChild(container);
  });

  it("resolves the correct view row via data-grid-row-index with 3 pinned-top rows", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="10" data-grid-row-index="5">
        <div role="gridcell" aria-colindex="1" data-column-id="name">Grace</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toEqual({ kind: "cell", row: 5, col: 0, columnId: "name" });
    document.body.removeChild(container);
  });

  it("excludes pinned-row cells (data-grid-pinned-row) from cell resolution", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="2">
        <div role="gridcell" aria-colindex="1" data-column-id="name" data-grid-pinned-row>Total</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toBeNull();
    document.body.removeChild(container);
  });

  it("excludes marker cells from cell resolution", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row" aria-rowindex="2">
        <div role="gridcell" data-grid-marker-cell aria-colindex="1">1</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toBeNull();
    document.body.removeChild(container);
  });

  it("returns null for a gridcell missing a containing [role=row]", () => {
    const cell = document.createElement("div");
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-colindex", "1");
    cell.setAttribute("data-column-id", "name");
    document.body.appendChild(cell);
    expect(resolveContextMenuTarget(cell)).toBeNull();
    document.body.removeChild(cell);
  });

  it("returns null for a header cell that has aria-colindex but no data-column-id", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "columnheader");
    el.setAttribute("aria-colindex", "2");
    document.body.appendChild(el);
    expect(resolveContextMenuTarget(el)).toBeNull();
    document.body.removeChild(el);
  });

  it("returns null for a gridcell missing aria-colindex or data-column-id", () => {
    const noCol = document.createElement("div");
    noCol.setAttribute("role", "gridcell");
    noCol.setAttribute("data-column-id", "age");
    document.body.appendChild(noCol);
    expect(resolveContextMenuTarget(noCol)).toBeNull();
    document.body.removeChild(noCol);

    const noId = document.createElement("div");
    noId.setAttribute("role", "gridcell");
    noId.setAttribute("aria-colindex", "2");
    document.body.appendChild(noId);
    expect(resolveContextMenuTarget(noId)).toBeNull();
    document.body.removeChild(noId);
  });

  it("treats non-numeric aria attributes as absent", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "columnheader");
    el.setAttribute("aria-colindex", "abc");
    el.setAttribute("data-column-id", "age");
    document.body.appendChild(el);
    expect(resolveContextMenuTarget(el)).toBeNull();
    document.body.removeChild(el);
  });

  it("returns null when the row carries neither data-grid-row-index nor aria-rowindex", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div role="row">
        <div role="gridcell" aria-colindex="2" data-column-id="age">30</div>
      </div>
    `;
    document.body.appendChild(container);
    const cell = container.querySelector('[role="gridcell"]') as Element;
    expect(resolveContextMenuTarget(cell)).toBeNull();
    document.body.removeChild(container);
  });

  it("returns null when the target is neither a header nor a data cell", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(resolveContextMenuTarget(el)).toBeNull();
    document.body.removeChild(el);
  });
});
