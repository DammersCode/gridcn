import { expect } from "vitest";

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
export const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

export const gridElement = () => document.querySelector<HTMLElement>('[role="grid"]')!;

export const mountedRows = () => [...gridElement().querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index]')];

export const rowAt = (viewIndex: number) => gridElement().querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${viewIndex}"]`)!;

export const cellAt = (viewIndex: number, columnId: string) =>
  rowAt(viewIndex).querySelector<HTMLElement>(`[role="gridcell"][data-column-id="${columnId}"]`)!;

export const firstRowHeight = () => mountedRows()[0]!.getBoundingClientRect().height;

/** Scrolls one tick of `tickRows` rows at a time to `targetRow`, so the origin trails and rebases like a real scroll. */
export async function scrollByTicks(targetRow: number, rowHeight: number, tickRows = 30) {
  const grid = gridElement();
  const start = Math.round(grid.scrollTop / rowHeight);
  const step = targetRow >= start ? tickRows : -tickRows;
  for (let row = start + step; step > 0 ? row < targetRow : row > targetRow; row += step) {
    grid.scrollTop = row * rowHeight;
    await frame();
    await frame();
  }
  grid.scrollTop = targetRow * rowHeight;
  await settle();
}

/** True once a surviving row sits at a smaller grid line than its view index, i.e. the origin moved off the top. */
export function originRebased() {
  const row = mountedRows()[3]!;
  return Number(row.style.gridRowStart) < Number(row.dataset["gridRowIndex"]);
}

export function unionRect(elements: readonly Element[]) {
  return elements
    .map((element) => element.getBoundingClientRect())
    .reduce((union, r) => ({
      left: Math.min(union.left, r.left),
      top: Math.min(union.top, r.top),
      right: Math.max(union.right, r.right),
      bottom: Math.max(union.bottom, r.bottom),
    }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

type Edges = { left: number; top: number; right: number; bottom: number };

export function expectEdgesWithin(actual: Edges, expected: Edges, tolerance = 1) {
  expect(Math.abs(actual.left - expected.left)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.top - expected.top)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.right - expected.right)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.bottom - expected.bottom)).toBeLessThanOrEqual(tolerance);
}
