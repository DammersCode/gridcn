export function frameDelta(nowMs: number, lastMs: number, capMs = 100): number {
  // cap absorbs the hidden-tab gap on resume so the animation doesn't jump
  return Math.min(Math.max(nowMs - lastMs, 0), capMs) / 1000;
}

export function lerpStep(current: number, target: number, perFrame: number, dt: number): number {
  const lambda = -Math.log(1 - perFrame) * 60;
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function decayStep(value: number, keepPerFrame: number, dt: number): number {
  return value * Math.exp(Math.log(keepPerFrame) * 60 * dt);
}
