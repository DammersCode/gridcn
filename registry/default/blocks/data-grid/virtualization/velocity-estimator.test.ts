import { describe, expect, it, vi } from "vitest";
import { createVelocityEstimator, updateVelocityEstimate, VELOCITY_OVERSCAN_CAP_PX } from "./velocity-estimator";

describe("velocity estimator (Phase 4)", () => {
  it("starts at 0 and stays 0 for sub-trigger deltas", () => {
    const estimator = createVelocityEstimator();
    expect(updateVelocityEstimate(estimator, 10, true)).toBe(0);
    expect(updateVelocityEstimate(estimator, -20, true)).toBe(0);
  });

  it("ramps up over a few ticks once a delta exceeds the trigger threshold, not instantly to the cap", () => {
    const estimator = createVelocityEstimator();
    const first = updateVelocityEstimate(estimator, 800, true);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(VELOCITY_OVERSCAN_CAP_PX);
  });

  it("holds at least the largest observed magnitude even mid-ramp", () => {
    const estimator = createVelocityEstimator();
    updateVelocityEstimate(estimator, 500, true);
    const afterBigTick = updateVelocityEstimate(estimator, 1500, true);
    expect(afterBigTick).toBeGreaterThanOrEqual(1500);
  });

  it("clamps the estimate at VELOCITY_OVERSCAN_CAP_PX even for a delta far beyond it", () => {
    const estimator = createVelocityEstimator();
    const estimate = updateVelocityEstimate(estimator, 100_000, true);
    expect(estimate).toBe(VELOCITY_OVERSCAN_CAP_PX);
  });

  it("decays the estimate on a small delta while still scrolling", () => {
    const estimator = createVelocityEstimator();
    updateVelocityEstimate(estimator, 1500, true);
    const decayed = updateVelocityEstimate(estimator, 10, true);
    expect(decayed).toBeGreaterThan(0);
    expect(decayed).toBeLessThan(1500);
  });

  it("resets to 0 once genuinely idle (settle observed well past the idle gate)", () => {
    vi.useFakeTimers();
    const estimator = createVelocityEstimator();
    const beforeSettle = updateVelocityEstimate(estimator, 1500, true);
    expect(beforeSettle).toBeGreaterThan(0);
    vi.advanceTimersByTime(200); // past SETTLE_RESET_MIN_IDLE_MS (150ms)
    const atSettle = updateVelocityEstimate(estimator, 0, false);
    expect(atSettle).toBe(0);
    vi.useRealTimers();
  });

  it("does not reset immediately on a settle observed right after the last tick (spurious-settle guard)", () => {
    vi.useFakeTimers();
    const estimator = createVelocityEstimator();
    const beforeSettle = updateVelocityEstimate(estimator, 1500, true);
    const atSettle = updateVelocityEstimate(estimator, 0, false); // no time advanced — looks like a same-tick settle
    expect(atSettle).toBe(beforeSettle);
    vi.useRealTimers();
  });

  it("still resets via the scheduled retry if no further tick arrives before the idle gate elapses", () => {
    vi.useFakeTimers();
    const estimator = createVelocityEstimator();
    const onIdleReset = vi.fn();
    // The tick itself arms the settle retry (so a retry is always pending 150ms past the last tick);
    // onIdleReset is passed on every observation, tick and settle alike.
    updateVelocityEstimate(estimator, 1500, true, onIdleReset);
    updateVelocityEstimate(estimator, 0, false, onIdleReset); // premature settle; the tick's retry is already pending
    expect(estimator.estimate).toBeGreaterThan(0);

    vi.advanceTimersByTime(150); // the tick's retry fires 150ms past the last tick

    expect(estimator.estimate).toBe(0);
    expect(onIdleReset).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("a real tick cancels the premature retry and re-arms a fresh one from that tick", () => {
    vi.useFakeTimers();
    const estimator = createVelocityEstimator();
    const onIdleReset = vi.fn();
    updateVelocityEstimate(estimator, 1500, true, onIdleReset); // tick 1 @0: arms retry @150
    updateVelocityEstimate(estimator, 0, false, onIdleReset); // premature settle @0: no new arm (retry pending)
    expect(estimator.estimate).toBeGreaterThan(0);

    vi.advanceTimersByTime(50);
    updateVelocityEstimate(estimator, 800, true, onIdleReset); // tick 2 @50: cancels the @150 retry, re-arms @200
    vi.advanceTimersByTime(149); // now=199: the @200 retry has not fired — still scrolling, no reset
    expect(estimator.estimate).toBeGreaterThan(0);
    expect(onIdleReset).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // now=200: 150ms past tick 2, the re-armed retry fires
    expect(estimator.estimate).toBe(0);
    expect(onIdleReset).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("ramps normally again after a settle reset, as if starting fresh", () => {
    vi.useFakeTimers();
    const estimator = createVelocityEstimator();
    updateVelocityEstimate(estimator, 1500, true);
    vi.advanceTimersByTime(200);
    updateVelocityEstimate(estimator, 0, false); // settle
    const afterSettleRamp = updateVelocityEstimate(estimator, 800, true);
    const freshRamp = updateVelocityEstimate(createVelocityEstimator(), 800, true);
    expect(afterSettleRamp).toBe(freshRamp);
    vi.useRealTimers();
  });

  it("decays toward the floor over repeated slow ticks", () => {
    const estimator = createVelocityEstimator();
    updateVelocityEstimate(estimator, 1500, true);
    let estimate = 0;
    for (let i = 0; i < 6; i++) estimate = updateVelocityEstimate(estimator, 5, true);
    expect(estimate).toBeLessThan(50);
  });

  it("treats signed deltas symmetrically (magnitude only)", () => {
    const up = createVelocityEstimator();
    const down = createVelocityEstimator();
    expect(updateVelocityEstimate(up, 800, true)).toBe(updateVelocityEstimate(down, -800, true));
  });
});
