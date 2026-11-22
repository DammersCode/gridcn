/** What the grid paints at one instant: the loaded body rows, the placeholders, the empty state, the busy flag, and the header. */
export type FrameSample = {
  via: "frame" | "mutation";
  /** `true` once the answer the change waits for was released; a change without an answer counts as released from the start. */
  released: boolean;
  rows: string;
  placeholders: number;
  groupRows: number;
  empty: boolean;
  busy: boolean;
  header: string;
  /** The text of the pinned row bands, the comment markers, the header widths, and every `aria-label` of the grid. */
  pinned: string;
  commentMarkers: number;
  columnWidths: string;
  ariaLabels: string;
  rowCount: string | null;
  colCount: string | null;
  /** Cells of the counted rows that carry `data-readonly`, and the root `aria-readonly`: a hold leaves both alone. */
  readonlyCells: number;
  ariaReadOnly: string | null;
};

const gridOf = (root: ParentNode) => root.querySelector<HTMLElement>('[role="grid"], [role="treegrid"]');

export function sampleGrid(root: ParentNode = document, via: FrameSample["via"] = "frame", released = true): FrameSample {
  const grid = gridOf(root);
  const box = grid?.getBoundingClientRect();
  // Only rows inside the grid's box count: overscan rows outside it change with the scroll speed and are not painted.
  const rows = [...(grid?.querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index]') ?? [])].filter((row) => {
    const rect = row.getBoundingClientRect();
    return box === undefined || (rect.bottom > box.top && rect.top < box.bottom);
  });
  const loaded = rows.filter((row) => row.getAttribute("aria-busy") !== "true" || row.getAttribute("data-save-status") === "saving");
  return {
    via,
    released,
    rows: loaded.map((row) => row.textContent ?? "").join("\n"),
    placeholders: rows.length - loaded.length,
    groupRows: rows.filter((row) => row.hasAttribute("data-grid-group-row")).length,
    empty: grid?.querySelector("[data-grid-empty-state]") != null,
    busy: grid?.getAttribute("aria-busy") === "true",
    header: [...(grid?.querySelectorAll('[role="columnheader"]') ?? [])].map((cell) => cell.textContent ?? "").join("|"),
    pinned: [...(grid?.querySelectorAll("[data-grid-pinned-row-band] [role=row]") ?? [])].map((row) => row.textContent ?? "").join("\n"),
    commentMarkers: grid?.querySelectorAll("[data-grid-comment-marker]").length ?? 0,
    columnWidths: [...(grid?.querySelectorAll("[role=columnheader]") ?? [])].map((cell) => Math.round(cell.getBoundingClientRect().width)).join("|"),
    ariaLabels: [...(grid?.querySelectorAll("[aria-label]") ?? [])].map((node) => node.getAttribute("aria-label")).join("|"),
    rowCount: grid?.getAttribute("aria-rowcount") ?? null,
    colCount: grid?.getAttribute("aria-colcount") ?? null,
    readonlyCells: rows.reduce((total, row) => total + row.querySelectorAll("[data-readonly]").length, 0),
    ariaReadOnly: grid?.getAttribute("aria-readonly") ?? null,
  };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Samples the grid on every DOM mutation and every animation frame while `action` runs, until `settled()` holds plus `tail` frames.
 * `action` runs synchronously after the recorder starts, so no frame of the change escapes it. `released()` tags each sample.
 */
export async function recordAcross(
  action: () => void,
  settled: () => boolean,
  { root = document.body, tail = 3, timeout = 5000, released = () => true }: { root?: HTMLElement; tail?: number; timeout?: number; released?: () => boolean } = {},
): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  const observer = new MutationObserver(() => samples.push(sampleGrid(root, "mutation", released())));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  let running = true;
  const tick = () => {
    if (!running) return;
    samples.push(sampleGrid(root, "frame", released()));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    action();
    const deadline = performance.now() + timeout;
    while (!settled()) {
      if (performance.now() > deadline) throw new Error("recordAcross: the grid did not settle");
      await nextFrame();
    }
    for (let left = tail; left > 0; left--) await nextFrame();
  } finally {
    running = false;
    observer.disconnect();
  }
  return samples;
}

const FIELDS = ["rows", "placeholders", "groupRows", "empty", "header", "pinned", "commentMarkers", "columnWidths", "ariaLabels", "rowCount", "colCount", "readonlyCells", "ariaReadOnly"] as const;
const HELD = ["rows", "empty", "header", "readonlyCells", "ariaReadOnly"] as const;

const same = (a: FrameSample, b: FrameSample, fields: readonly (keyof FrameSample)[]) => fields.every((field) => a[field] === b[field]);
const show = (sample: FrameSample) => JSON.stringify({ rows: sample.rows.slice(0, 60), empty: sample.empty, header: sample.header.slice(0, 40), placeholders: sample.placeholders });

/**
 * The samples that flash; an empty list means the change did not. Before the release a sample shows the old rows, empty state,
 * and header. After it, a whole sample is the old state or the new one, and once it showed the new state it never goes back.
 */
export function flashesIn(samples: readonly FrameSample[], before: FrameSample, after: FrameSample): string[] {
  const found: string[] = [];
  let arrived = false;
  for (const [index, sample] of samples.entries()) {
    const where = `${sample.via} ${index}`;
    if (!sample.released) {
      if (!same(sample, before, HELD)) found.push(`${where} before the release: ${show(sample)} is not the old state ${show(before)}`);
      continue;
    }
    const isAfter = same(sample, after, FIELDS);
    const isBefore = same(sample, before, FIELDS);
    if (!isAfter && !isBefore) found.push(`${where}: ${show(sample)} is neither ${show(before)} nor ${show(after)}`);
    else if (arrived && !isAfter) found.push(`${where}: went back to the old state after the new one`);
    arrived ||= isAfter && !isBefore;
  }
  return found;
}
