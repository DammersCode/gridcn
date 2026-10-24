import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

const rows: Row[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, name: `Person ${i}`, email: `p${i}@example.com`, age: 20 + (i % 50) }));

const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, width: 100 },
  { id: "name", header: "Name", accessorKey: "name" as const, width: 140 },
  { id: "email", header: "Email", accessorKey: "email" as const, width: 180 },
  { id: "age", header: "Age", accessorKey: "age" as const, type: "number" as const, width: 80 },
];

function renderGrid() {
  return render(
    <div style={{ height: 360, width: 700 }}>
      <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-90 w-175" />
    </div>,
  );
}

function cellAt(row: number, col: number): HTMLElement {
  const cell = document.querySelector<HTMLElement>(`[role="row"][aria-rowindex="${row + 2}"] [role="gridcell"][aria-colindex="${col + 1}"]`);
  if (!cell) throw new Error(`cell ${row}:${col} not rendered`);
  return cell;
}

function center(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function touch(target: Element | Document, type: string, point: { x: number; y: number }, pointerId = 7) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId, isPrimary: pointerId === 7, button: 0, clientX: point.x, clientY: point.y }),
  );
}

function tap(target: Element, pointerId = 7) {
  const point = center(target);
  touch(target, "pointerdown", point, pointerId);
  touch(document, "pointerup", point, pointerId);
}

function activeGridCell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="gridcell"][tabindex="0"]');
}

const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

describe("touch input in a real browser", () => {
  it("selects on a tap and shows two selection handles", async () => {
    await renderGrid();
    tap(cellAt(4, 1));
    await nextFrames();
    expect(activeGridCell()).toBe(cellAt(4, 1));
    expect(document.querySelectorAll(gridAttrSelector("selectionHandle")).length).toBe(2);
  });

  it("selects nothing when the finger pans and the pointer is cancelled", async () => {
    await renderGrid();
    const start = center(cellAt(4, 1));
    touch(cellAt(4, 1), "pointerdown", start);
    touch(document, "pointermove", { x: start.x, y: start.y - 60 });
    touch(document, "pointercancel", { x: start.x, y: start.y - 60 });
    await nextFrames();
    expect(activeGridCell()).toBeNull();
    expect(document.querySelectorAll(gridAttrSelector("selectionHandle")).length).toBe(0);
  });

  it("extends the range from the opposite corner when an end handle is dragged", async () => {
    await renderGrid();
    tap(cellAt(2, 1));
    await nextFrames();
    const handle = document.querySelector<HTMLElement>(`${gridAttrSelector("selectionHandle")}[data-grid-selection-handle="end"]`);
    expect(handle).not.toBeNull();
    touch(handle!, "pointerdown", center(handle!));
    const target = center(cellAt(5, 3));
    touch(document, "pointermove", target);
    await nextFrames();
    touch(document, "pointerup", target);
    await nextFrames();
    const overlay = document.querySelector<HTMLElement>("[data-grid-selection-overlay]");
    expect(overlay).not.toBeNull();
    const span = (start: string, end: string) => Number(end) - Number(start);
    expect(span(overlay!.style.gridColumnStart, overlay!.style.gridColumnEnd)).toBe(3);
    expect(span(overlay!.style.gridRowStart, overlay!.style.gridRowEnd)).toBe(4);
  });

  it("registers no non-passive touch or wheel listener while it renders and handles gestures", async () => {
    const offenders: string[] = [];
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patched(this: EventTarget, type: string, listener: unknown, options?: boolean | AddEventListenerOptions) {
      const passive = typeof options === "object" && options !== null && options.passive === true;
      if (/^(touchstart|touchmove|wheel|mousewheel)$/.test(type) && !passive) offenders.push(type);
      return original.call(this, type, listener as EventListenerOrEventListenerObject, options);
    };
    try {
      await renderGrid();
      tap(cellAt(3, 1));
      const start = center(cellAt(6, 2));
      touch(cellAt(6, 2), "pointerdown", start);
      touch(document, "pointermove", { x: start.x, y: start.y - 50 });
      touch(document, "pointercancel", start);
      await nextFrames();
    } finally {
      EventTarget.prototype.addEventListener = original;
    }
    expect(offenders).toEqual([]);
  });

  it("leaves no document listener behind when the grid unmounts in the middle of a press", async () => {
    const live = new Map<string, number>();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const key = (type: string, listener: unknown, options?: boolean | AddEventListenerOptions) =>
      `${type}|${String(listener)}|${typeof options === "object" ? options.capture === true : options === true}`;
    EventTarget.prototype.addEventListener = function patched(this: EventTarget, type: string, listener: unknown, options?: boolean | AddEventListenerOptions) {
      if (this === document && /^pointer|lostpointercapture/.test(type)) live.set(key(type, listener, options), (live.get(key(type, listener, options)) ?? 0) + 1);
      return add.call(this, type, listener as EventListenerOrEventListenerObject, options);
    };
    EventTarget.prototype.removeEventListener = function patched(this: EventTarget, type: string, listener: unknown, options?: boolean | AddEventListenerOptions) {
      if (this === document) live.delete(key(type, listener, options));
      return remove.call(this, type, listener as EventListenerOrEventListenerObject, options);
    };
    try {
      const screen = await renderGrid();
      const cell = cellAt(3, 1);
      touch(cell, "pointerdown", center(cell));
      await screen.unmount();
      touch(document, "pointerup", center(cell));
    } finally {
      EventTarget.prototype.addEventListener = add;
      EventTarget.prototype.removeEventListener = remove;
    }
    expect([...live.keys()].filter((entry) => !entry.startsWith("pointerdown"))).toEqual([]);
  });
});

describe("column grip on touch", () => {
  const headerIds = () => [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.getAttribute("data-column-id"));
  const headerEl = (columnId: string) => document.querySelector(`[role="columnheader"][data-column-id="${columnId}"]`)!;
  const gripOf = (columnId: string) => headerEl(columnId).querySelector<HTMLElement>(gridAttrSelector("columnReorderHandle"))!;

  function renderReorderable() {
    return render(
      <div style={{ height: 360, width: 700 }}>
        <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-90 w-175" enableColumnReorder />
      </div>,
    );
  }

  async function dragGrip(from: string, to: string, end: "pointerup" | "pointercancel") {
    touch(gripOf(from), "pointerdown", center(headerEl(from)));
    const target = center(headerEl(to));
    for (let i = 0; i < 3; i++) {
      touch(document, "pointermove", target);
      await nextFrames();
    }
    touch(document, "pointermove", { x: target.x + 2, y: target.y });
    touch(document, end, target);
    await nextFrames();
  }

  // the reorder control is display:none on a fine pointer (pointer-coarse:flex), so synthetic events target it directly
  it("dragging the grip with a touch pointer onto another header reorders the columns", async () => {
    await renderReorderable();
    await dragGrip("id", "email", "pointerup");
    expect(headerIds().indexOf("id")).toBeGreaterThan(headerIds().indexOf("name"));
  });

  it("a cancelled grip drag leaves the order unchanged", async () => {
    await renderReorderable();
    await dragGrip("id", "email", "pointercancel");
    expect(headerIds()).toEqual(["id", "name", "email", "age"]);
  });
});
