import { groupLayoutOfView } from "./view-rows";

const startsByView = new WeakMap<readonly number[], number[]>();

/** Where each top-level group row sits in the full grouped `view`; `null` for a view that holds no group rows. */
export function topGroupStarts(view: readonly number[]): readonly number[] | null {
  const layout = groupLayoutOfView(view);
  if (!layout) return null;
  let starts = startsByView.get(view);
  if (!starts) {
    starts = [];
    for (let row = 0; row < view.length; row++) {
      const entry = view[row]!;
      if (entry < 0 && layout.rows[-entry - 1]?.depth === 0) starts.push(row);
    }
    startsByView.set(view, starts);
  }
  return starts;
}

/** What one page of a paged view counts: top-level groups while the view is grouped, else rows. */
export function pageUnitsOf(view: readonly number[]): number {
  return topGroupStarts(view)?.length ?? view.length;
}

/** The slice of a grouped full `view` that page `page` shows: `size` top-level groups with the rows opened under them; `null` for a view that holds no group rows. */
export function groupedPageSpan(view: readonly number[], page: number, size: number): { start: number; end: number } | null {
  const starts = topGroupStarts(view);
  if (!starts) return null;
  const lastPage = Math.max(1, Math.ceil(starts.length / size));
  const first = (Math.min(Math.max(1, Math.floor(page) || 1), lastPage) - 1) * size;
  return { start: starts[first] ?? view.length, end: starts[first + size] ?? view.length };
}

/** The page that shows row `row` of the full `view` at `size` units per page. */
export function pageOfFullRow(view: readonly number[], row: number, size: number): number {
  const starts = topGroupStarts(view);
  if (!starts) return Math.floor(row / size) + 1;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= row) low = mid;
    else high = mid - 1;
  }
  return Math.floor(low / size) + 1;
}
