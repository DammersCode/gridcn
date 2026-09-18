#!/usr/bin/env node
// Opt-in retained-heap profiler (workplan item 9, PLAN §4.6 method) — NOT wired into CI. Drives
// the ALREADY-RUNNING dev server's /dev page via Playwright + raw CDP HeapProfiler (no snapshot
// diffing lib: `takeHeapSnapshot` streams chunks we concat, then sum `node.self_size` ourselves —
// good enough for "did retained heap grow" without a full snapshot-graph parser dependency).
//
// Usage: npm run perf:heap  (dev server must already be running on :3000 — this script never
// starts/stops it, so the user's own dev session survives).
import { chromium } from "playwright";

const BASE_URL = process.env.GRIDCN_DEV_URL ?? "http://localhost:3000/dev";
// Must match app/dev/page.tsx's ROW_OPTIONS exactly (a <select>, no arbitrary value) — workplan
// asked for 10/1k/100k; the dev page's smallest option is 1,000, so that's the floor available.
// 1M included too since the dev page doesn't cap lower (workplan: "skip 1M if the dev page caps lower").
const ROW_COUNTS = [1_000, 100_000, 1_000_000];
const SCROLL_BURST_TICKS = 60;
const MOUNT_CYCLES = 5;

/** Forces GC (requires --expose-gc-equivalent via CDP; Chromium's HeapProfiler.collectGarbage does this without any launch flag). */
async function collectGarbage(client) {
  await client.send("HeapProfiler.collectGarbage");
}

/** Sums every node's self_size out of a streamed `.heapsnapshot` — avoids a full graph-parser dependency.
 * Chunks are collected into an array and joined once (not `+=`'d) — at 1M rows the serialized
 * snapshot approaches V8's ~1GB string-length ceiling, and repeated `+=` concatenation is O(n^2)
 * on some engines besides being slower; a single join is the cheapest correct way to assemble it. */
async function takeHeapSnapshotBytes(client) {
  const chunks = [];
  const onChunk = (params) => {
    chunks.push(params.chunk);
  };
  client.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  client.off("HeapProfiler.addHeapSnapshotChunk", onChunk);

  const parsed = JSON.parse(chunks.join(""));
  const meta = parsed.snapshot.meta;
  const nodeFields = meta.node_fields;
  const nodeTypes = meta.node_types[nodeFields.indexOf("type")];
  const selfSizeIdx = nodeFields.indexOf("self_size");
  const typeIdx = nodeFields.indexOf("type");
  const stride = nodeFields.length;
  const nodes = parsed.nodes;

  let totalBytes = 0;
  const byType = new Map();
  for (let i = 0; i < nodes.length; i += stride) {
    const size = nodes[i + selfSizeIdx];
    totalBytes += size;
    const typeName = nodeTypes[nodes[i + typeIdx]] ?? String(nodes[i + typeIdx]);
    byType.set(typeName, (byType.get(typeName) ?? 0) + size);
  }
  return { totalBytes, byType, nodeCount: nodes.length / stride };
}

function fmtMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

async function selectRowCount(page, rowCount) {
  await page.selectOption('label:has-text("rows") select', String(rowCount));
  // key={rowCount} on DevGrid forces a clean remount — wait for the grid to reflect the new row count.
  await page.waitForFunction(
    (expected) => {
      const grid = document.querySelector('[role="grid"]');
      return grid && grid.getAttribute("aria-rowcount") === String(expected + 1); // +1: header row
    },
    rowCount,
    { timeout: 30_000 },
  );
}

async function scrollBurst(page, ticks) {
  await page.evaluate(async (n) => {
    const grid = document.querySelector('[role="grid"]');
    if (!grid) return;
    const maxTop = Math.max(1, grid.scrollHeight - grid.clientHeight);
    for (let i = 0; i < n; i++) {
      grid.scrollTop = (i * 733) % maxTop; // 733: irregular stride, avoids resonating with row height
      grid.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 8));
    }
    grid.scrollTop = 0;
    grid.dispatchEvent(new Event("scroll"));
  }, ticks);
  // let scrollend/debounce settle (ISSCROLLING_DEBOUNCE_MS=150 in use-row-window.ts) before snapshotting.
  await page.waitForTimeout(400);
}

async function profileRowCount(browser, rowCount) {
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  await client.send("HeapProfiler.enable");

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await selectRowCount(page, rowCount);

  await collectGarbage(client);
  const afterMount = await takeHeapSnapshotBytes(client);

  await scrollBurst(page, SCROLL_BURST_TICKS);
  await collectGarbage(client);
  const afterScrollBurst = await takeHeapSnapshotBytes(client);

  // 5 mount/unmount cycles (leak check): toggle row count away and back, forcing DevGrid's
  // key={rowCount} to unmount/remount the whole grid tree each time.
  const otherRowCount = ROW_COUNTS.find((n) => n !== rowCount) ?? rowCount;
  for (let i = 0; i < MOUNT_CYCLES; i++) {
    await selectRowCount(page, otherRowCount);
    await selectRowCount(page, rowCount);
  }
  await collectGarbage(client);
  const afterMountCycles = await takeHeapSnapshotBytes(client);

  await page.close();
  return { rowCount, afterMount, afterScrollBurst, afterMountCycles };
}

async function main() {
  console.log(`gridcn heap profile — target ${BASE_URL} (dev server must already be running)`);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const rowCount of ROW_COUNTS) {
      console.log(`\n--- ${rowCount.toLocaleString()} rows ---`);
      const result = await profileRowCount(browser, rowCount);
      results.push(result);
      console.log(`  after mount:          ${fmtMB(result.afterMount.totalBytes)} (${result.afterMount.nodeCount.toLocaleString()} nodes)`);
      console.log(`  after scroll burst:   ${fmtMB(result.afterScrollBurst.totalBytes)} (${result.afterScrollBurst.nodeCount.toLocaleString()} nodes)`);
      console.log(`  after ${MOUNT_CYCLES} mount cycles: ${fmtMB(result.afterMountCycles.totalBytes)} (${result.afterMountCycles.nodeCount.toLocaleString()} nodes)`);
      const leakDeltaBytes = result.afterMountCycles.totalBytes - result.afterMount.totalBytes;
      const leakDeltaPct = (leakDeltaBytes / result.afterMount.totalBytes) * 100;
      console.log(`  mount-cycle delta:    ${leakDeltaBytes >= 0 ? "+" : ""}${fmtMB(leakDeltaBytes)} (${leakDeltaPct.toFixed(1)}%)`);
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Summary table (retained heap, MB) ===");
  console.log("rows\t\tafter mount\tafter scroll\tafter 5 cycles\tcycle delta");
  for (const r of results) {
    const delta = r.afterMountCycles.totalBytes - r.afterMount.totalBytes;
    console.log(
      `${r.rowCount.toLocaleString()}\t\t${fmtMB(r.afterMount.totalBytes)}\t${fmtMB(r.afterScrollBurst.totalBytes)}\t${fmtMB(r.afterMountCycles.totalBytes)}\t${delta >= 0 ? "+" : ""}${fmtMB(delta)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
