#!/usr/bin/env node
// Micro-benchmark of the `cn` class merger on this repo's real cn() call shapes (stable
// strings + boolean conditionals, no object args). Measured 2026-09-15 (Windows, Node 24):
// cn 0.3.0 ~15 ns/call, the replaced cnfast 0.2.0 ~16 ns/call, the classic
// twMerge(clsx(...)) baseline ~190 ns/call. Run: node scripts/bench-cn.mjs
import { cn } from "cn";

const BASES = [
  "relative select-none overflow-auto rounded-md border border-border bg-background text-sm",
  "group flex items-center justify-center border-b border-border bg-background",
  "absolute end-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:end-[2px] after:w-[3px] after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60 data-[resizing]:after:opacity-100",
  "group relative flex items-center border-b border-border bg-muted px-2 font-medium select-none",
  "min-h-0 flex-1 overflow-hidden rounded-md border border-border",
  "select-none text-xs tabular-nums text-muted-foreground",
];
const TAILS = ["", "bg-primary", "opacity-50", "hidden group-hover:flex data-checked:flex"];

const N = 300_000;
const RUNS = 15;

let sink = 0;
const times = [];
for (let i = 0; i < 10_000; i++) {
  sink += cn(BASES[i % BASES.length], TAILS[i % TAILS.length]).length;
}
for (let run = 0; run < RUNS; run++) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    const call = BASES[i % BASES.length];
    const tail = TAILS[i % TAILS.length];
    sink += cn(call, i % 2 === 0 && tail, i % 3 === 0 && "text-white", tail || null).length;
  }
  times.push(Number(process.hrtime.bigint() - t0));
}
times.sort((a, b) => a - b);
const median = times[Math.floor(RUNS / 2)];
const best2 = (times[0] + times[1]) / 2;
console.log(`cn ${JSON.stringify(process.env.npm_package_version ?? "")} repo call shapes: median ${(median / N).toFixed(1)} ns/call, best-2-avg ${(best2 / N).toFixed(1)} ns/call (${RUNS} runs x ${N} calls)`);
console.log("sink:", sink);
