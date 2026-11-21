/** What the grid paints at one instant: the loaded body rows, the placeholders, the empty state, the busy flag, and the header. */
export type FrameSample = {
  via: "frame" | "mutation";
  rows: string;
  placeholders: number;
  groupRows: number;
  empty: boolean;
  busy: boolean;
  header: string;
  rowCount: string | null;
  colCount: string | null;
};

const gridOf = (root: ParentNode) => root.querySelector<HTMLElement>('[role="grid"], [role="treegrid"]');

export function sampleGrid(root: ParentNode = document, via: FrameSample["via"] = "frame"): FrameSample {
  const grid = gridOf(root);
  const rows = [...(grid?.querySelectorAll<HTMLElement>('[role="row"][data-grid-row-index]') ?? [])];
  const loaded = rows.filter((row) => row.getAttribute("aria-busy") !== "true" || row.getAttribute("data-save-status") === "saving");
  return {
    via,
    rows: loaded.map((row) => row.textContent ?? "").join("\n"),
    placeholders: rows.length - loaded.length,
    groupRows: rows.filter((row) => row.hasAttribute("data-grid-group-row")).length,
    empty: grid?.querySelector("[data-grid-empty-state]") != null,
    busy: grid?.getAttribute("aria-busy") === "true",
    header: [...(grid?.querySelectorAll('[role="columnheader"]') ?? [])].map((cell) => cell.textContent ?? "").join("|"),
    rowCount: grid?.getAttribute("aria-rowcount") ?? null,
    colCount: grid?.getAttribute("aria-colcount") ?? null,
  };
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Samples the grid on every DOM mutation and every animation frame while `action` runs, until `settled()` holds plus `tail` frames.
 * `action` runs synchronously after the recorder starts, so no frame of the change escapes it.
 */
export async function recordAcross(action: () => void, settled: () => boolean, { root = document.body, tail = 3, timeout = 5000 }: { root?: HTMLElement; tail?: number; timeout?: number } = {}): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  const observer = new MutationObserver(() => samples.push(sampleGrid(root, "mutation")));
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  let running = true;
  const tick = () => {
    if (!running) return;
    samples.push(sampleGrid(root, "frame"));
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

const FIELDS = ["rows", "placeholders", "groupRows", "empty", "header", "rowCount", "colCount"] as const;

/** The samples that differ from both the old and the new settled state, field by field; an empty list means the change did not flash. */
export function flashesIn(samples: readonly FrameSample[], before: FrameSample, after: FrameSample): string[] {
  const found: string[] = [];
  for (const [index, sample] of samples.entries()) {
    for (const field of FIELDS) {
      if (sample[field] === before[field] || sample[field] === after[field]) continue;
      found.push(`${sample.via} ${index}: ${field} ${JSON.stringify(sample[field]).slice(0, 80)} is neither ${JSON.stringify(before[field]).slice(0, 80)} nor ${JSON.stringify(after[field]).slice(0, 80)}`);
    }
  }
  return found;
}
