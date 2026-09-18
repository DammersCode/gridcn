"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { decayStep, frameDelta, lerpStep } from "./hero-shader-timing";

const CELL_W = 52;
const CELL_H = 26;
const DASH_PATTERNS: number[][] = [[], [5, 3], [2, 3]];
const GHOST_NAMES = ["Ada", "Kim", "Rio"];

// non-interactive targets a drag-start must avoid, so page interaction keeps working under the canvas
const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,label,[role='button'],[data-hero-shader-interactive]";

type Ghost = {
  c0: number;
  c1: number;
  phase: number;
  selRow: number | null;
  selW: number;
  seed: number;
};

function makeGhosts(): Ghost[] {
  return [0, 1, 2].map((i) => ({
    c0: i * 5,
    c1: i * 5 + 3,
    phase: i * 2.1,
    selRow: null,
    selW: 1,
    seed: i * 61 + 3,
  }));
}

// matches the mockup's integer hash exactly, so cell content is stable across frames
function hash(x: number, y: number): number {
  let n = x * 374761393 + y * 668265263;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/**
 * Full-page ambient "living grid" background for the docs landing page. Canvas 2D (not WebGPU) —
 * this is a faithful port of the approved mockup sketch, which needs native text/rect rendering.
 * All animation state lives in refs and is mutated in the rAF loop; zero React re-renders per frame.
 */
export function HeroShader(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return setupScene(canvas);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 size-full"
      style={{ pointerEvents: "none" }}
    />
  );
}

let readbackCanvas: HTMLCanvasElement | null = null;
let readbackCtx: CanvasRenderingContext2D | null = null;

// getComputedStyle preserves oklch/lab/etc strings verbatim on Chromium instead of resolving to rgb,
// so a regex parse silently fails on this theme's oklch tokens — canvas fillStyle resolves any CSS color universally
function resolveColorToRgb(raw: string): [number, number, number] {
  if (!readbackCanvas) {
    readbackCanvas = document.createElement("canvas");
    readbackCanvas.width = 1;
    readbackCanvas.height = 1;
    readbackCtx = readbackCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!readbackCtx) return [38, 36, 31];
  readbackCtx.clearRect(0, 0, 1, 1);
  readbackCtx.fillStyle = raw;
  readbackCtx.fillRect(0, 0, 1, 1);
  const [r = 38, g = 36, b = 31] = readbackCtx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function readInk(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();
  if (!raw) return [38, 36, 31];
  return resolveColorToRgb(raw);
}

function inkAlpha(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function readBackgroundIsDark(): boolean {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  if (!raw) return false;
  const [r, g, b] = resolveColorToRgb(raw);
  // perceptual luma; dark paper needs a stronger ink boost to read at the same alpha as light paper
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function setupScene(canvas: HTMLCanvasElement): () => void {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) return () => {};
  const ctx = maybeCtx;

  const reducedMotionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    w: 0,
    h: 0,
    dpr: 1,
    t: 0,
    off: 0,
    lastOff: 0,
    speed: 0.35,
    mom: 0,
    dragging: false,
    lastClientY: 0,
    flick: 0,
    px: null as number | null,
    py: null as number | null,
    uy: 0,
    halfS: 2.2,
    visible: true,
    reduced: reducedMotionQuery.matches,
  };

  let ink = readInk();
  // dark paper reads low-alpha ink as almost nothing, so boost alpha there to match perceived strength on light paper
  let darkBoost = readBackgroundIsDark() ? 2.4 : 1;
  const ink0 = (a: number) => inkAlpha(ink, Math.min(1, a * darkBoost));
  const refreshInk = () => {
    ink = readInk();
    darkBoost = readBackgroundIsDark() ? 2.4 : 1;
  };
  const themeObserver = new MutationObserver(refreshInk);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  const colorSchemeQuery = matchMedia("(prefers-color-scheme: dark)");
  colorSchemeQuery.addEventListener("change", refreshInk);

  const ghosts = makeGhosts();

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    state.dpr = dpr;
    canvas.width = Math.round(state.w * dpr);
    canvas.height = Math.round(state.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state.py === null) state.uy = state.h / 2;
    // setting canvas.width/height clears it — reduced-motion has no rAF redraw to self-heal, so force one
    if (state.reduced) draw();
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(document.body);

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return target.closest(INTERACTIVE_SELECTOR) !== null;
  };

  const onPointerMove = (e: PointerEvent) => {
    state.px = e.clientX;
    state.py = e.clientY;
    if (state.dragging) {
      const dy = e.clientY - state.lastClientY;
      state.off -= dy;
      state.flick = state.flick * 0.5 + -dy * 0.5;
      state.lastClientY = e.clientY;
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    state.dragging = true;
    state.lastClientY = e.clientY;
    state.flick = 0;
    state.mom = 0;
  };
  const endDrag = () => {
    if (!state.dragging) return;
    state.dragging = false;
    state.mom = state.flick;
  };
  const onPointerLeaveWindow = () => {
    state.px = null;
    state.py = null;
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  document.addEventListener("pointerleave", onPointerLeaveWindow);

  const intersectionObserver = new IntersectionObserver((entries) => {
    // IntersectionObserver always calls back with >=1 entry for an observed target
    state.visible = entries[0]!.isIntersecting;
  });
  intersectionObserver.observe(canvas);
  const onVisibilityChange = () => {
    state.visible = document.hidden ? false : true;
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  const onReducedMotionChange = () => {
    state.reduced = reducedMotionQuery.matches;
  };
  reducedMotionQuery.addEventListener("change", onReducedMotionChange);

  function gridLines(offset: number, alpha: number) {
    ctx.strokeStyle = ink0(alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < state.w; x += CELL_W) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.h);
    }
    const y0 = -(((offset % CELL_H) + CELL_H) % CELL_H);
    for (let y = y0 + 0.5; y < state.h; y += CELL_H) {
      ctx.moveTo(0, y);
      ctx.lineTo(state.w, y);
    }
    ctx.stroke();
  }

  function skeleton(x: number, y: number, row: number, col: number, a: number) {
    ctx.fillStyle = ink0(a * 0.22);
    ctx.beginPath();
    ctx.roundRect(x + 7, y + 9, (CELL_W - 16) * (0.35 + hash(row, col) * 0.5), CELL_H - 18, 4);
    ctx.fill();
  }

  function value(x: number, y: number, row: number, col: number, a: number) {
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink0(a * 0.85);
    ctx.fillText(String(100 + Math.floor(hash(row, col) * 8900)), x + 8, y + CELL_H / 2);
  }

  function ghostCursor(x: number, y: number, w: number, h: number, dash: number[], name: string, a: number) {
    ctx.fillStyle = ink0(a * 0.1);
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash(dash);
    ctx.strokeStyle = ink0(a * 0.8);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
    ctx.font = "600 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = ink0(a * 0.85);
    ctx.fillText(name, x + 2, y - 3);
  }

  function draw(dt = 1 / 60) {
    ctx.clearRect(0, 0, state.w, state.h);

    const target = state.px === null ? 0.35 : 0;
    state.speed = lerpStep(state.speed, target, 0.04, dt);
    state.mom = decayStep(state.mom, 0.94, dt);
    state.off += state.dragging ? 0 : (state.speed + state.mom) * dt * 60;
    const dOff = state.off - state.lastOff;
    state.lastOff = state.off;

    gridLines(state.off, 0.16);

    const cols = Math.ceil(state.w / CELL_W);
    const userY = state.py === null ? state.h / 2 : state.py;
    state.uy = lerpStep(state.uy, userY, 0.08, dt);

    const targetHalf = Math.min(2.2 + Math.abs(dOff) * 0.35, 5.5);
    state.halfS = lerpStep(state.halfS, targetHalf, targetHalf > state.halfS ? 0.3 : 0.06, dt);

    const bands = ghosts.map((ghost, i) => {
      ghost.c1 = Math.min(cols - 1, ghost.c0 + 3);
      const cy = state.h * (0.5 + 0.34 * Math.sin(state.t * 0.25 + ghost.phase));
      if (ghost.selRow === null || (((state.t * 60) | 0) % 300) === i * 90) {
        ghost.seed++;
        ghost.selRow = Math.floor((cy + state.off) / CELL_H) + 2 + Math.floor(hash(ghost.seed, 4) * 3);
        ghost.selW = 1 + Math.floor(hash(5, ghost.seed) * 2);
      }
      return { cy, half: 1.6, c0: ghost.c0, c1: ghost.c1, ghost, i };
    });

    for (let sy = -CELL_H; sy < state.h + CELL_H; sy += CELL_H) {
      const row = Math.floor((sy + state.off) / CELL_H);
      const y = row * CELL_H - state.off;
      const ymid = y + CELL_H / 2;
      for (let c = 0; c < cols; c++) {
        let a = Math.min(1, 1 - (Math.abs(ymid - state.uy) / CELL_H - state.halfS) / 1.8);
        for (const b of bands) {
          if (c >= b.c0 && c <= b.c1) {
            a = Math.max(a, Math.min(1, 1 - (Math.abs(ymid - b.cy) / CELL_H - b.half) / 1.5));
          }
        }
        if (a > 0.55) value(c * CELL_W, y, row, c, (a - 0.55) / 0.45);
        else if (a > 0.05) skeleton(c * CELL_W, y, row, c, a / 0.55);
      }
    }

    for (const b of bands) {
      const x = b.c0 * CELL_W;
      const w = (b.c1 - b.c0 + 1) * CELL_W;
      ghostCursor(x, b.cy - CELL_H / 2, w, CELL_H, DASH_PATTERNS[b.i] ?? [], GHOST_NAMES[b.i] ?? "", 0.8);
      const sy = (b.ghost.selRow ?? 0) * CELL_H - state.off;
      if (sy > -CELL_H && sy < state.h) {
        const dash = DASH_PATTERNS[b.i];
        ctx.setLineDash(dash && dash.length ? dash : [4, 2]);
        ctx.strokeStyle = ink0(0.55);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, sy + 0.5, b.ghost.selW * CELL_W, CELL_H);
        ctx.setLineDash([]);
      }
    }

    ctx.strokeStyle = ink0(0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, state.uy - state.halfS * CELL_H, state.w + 4, state.halfS * 2 * CELL_H);
  }

  let rafId = 0;
  let lastNow = performance.now();
  const frame = () => {
    rafId = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = frameDelta(now, lastNow);
    lastNow = now;
    if (!state.visible) return;
    if (state.reduced) {
      if (state.t === 0) {
        state.t = 3;
        draw();
      }
      return;
    }
    state.t += dt;
    draw(dt);
  };
  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    themeObserver.disconnect();
    intersectionObserver.disconnect();
    colorSchemeQuery.removeEventListener("change", refreshInk);
    reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("pointerleave", onPointerLeaveWindow);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  };
}
