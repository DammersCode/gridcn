import { describe, expect, it } from "vitest";
import { decayStep, frameDelta, lerpStep } from "../components/hero-shader-timing";

function simulate(steps: number, stepMs: number, step: (dt: number) => void): number {
  let lastMs = 0;
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const nowMs = lastMs + stepMs;
    const dt = frameDelta(nowMs, lastMs);
    t += dt;
    step(dt);
    lastMs = nowMs;
  }
  return t;
}

describe("hero-shader timing", () => {
  it("accumulates the same time over one simulated second at 60 fps and 144 fps", () => {
    const t60 = simulate(60, 1000 / 60, () => {});
    const t144 = simulate(144, 1000 / 144, () => {});
    expect(Math.abs(t60 - t144)).toBeLessThan(1e-9);
  });

  it("converges a lerp to the same value after one simulated second at 60 fps and 144 fps", () => {
    const run = (steps: number, stepMs: number) => {
      let v = 0;
      simulate(steps, stepMs, (dt) => {
        v = lerpStep(v, 1, 0.04, dt);
      });
      return v;
    };
    const v60 = run(60, 1000 / 60);
    const v144 = run(144, 1000 / 144);
    expect(Math.abs(v60 - v144)).toBeLessThan(1e-6);
    expect(v60).toBeGreaterThan(0.9);
  });

  it("decays a value to the same result after one simulated second at 60 fps and 144 fps", () => {
    const run = (steps: number, stepMs: number) => {
      let v = 1;
      simulate(steps, stepMs, (dt) => {
        v = decayStep(v, 0.94, dt);
      });
      return v;
    };
    const v60 = run(60, 1000 / 60);
    const v144 = run(144, 1000 / 144);
    expect(Math.abs(v60 - v144)).toBeLessThan(1e-6);
    expect(v60).toBeCloseTo(0.94 ** 60, 9);
  });

  it("frameDelta caps a 5000 ms gap at 0.1 s", () => {
    expect(frameDelta(5000, 0)).toBe(0.1);
  });

  it("frameDelta returns 0 for equal timestamps", () => {
    expect(frameDelta(1000, 1000)).toBe(0);
  });

  it("frameDelta clamps a negative delta to 0", () => {
    expect(frameDelta(500, 1000)).toBe(0);
  });

  it("frameDelta honors a custom cap", () => {
    expect(frameDelta(250, 0, 100)).toBe(0.1);
    expect(frameDelta(50, 0, 1000)).toBe(0.05);
  });
});
