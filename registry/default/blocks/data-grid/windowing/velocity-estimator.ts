/**
 * Decaying-max velocity estimator (Phase 4): the window rendered after tick N must already cover
 * tick N+1's jump, but tick N+1's magnitude is unknown when tick N commits, and scrollbar-drag deltas
 * don't trend smoothly tick-to-tick (a slow tick can be immediately followed by a hard jump) — so
 * predicting "the next delta" from recent magnitudes alone can't be made reliable; a run of merely
 * average ticks gives no warning before an unprecedented one. Instead: any tick whose delta exceeds
 * {@link VELOCITY_TRIGGER_PX} (a real drag, not sub-row jitter) ramps the estimate toward the cap over
 * ~{@link VELOCITY_RAMP_TICKS} ticks, on the theory that once a drag is confirmed fast, ANY subsequent
 * tick could be the hard one — holding near the cap for the gesture's duration is what "must hold near
 * the MAX of recent deltas, not the mean" means in practice once deltas are this bursty. A small delta
 * WHILE STILL SCROLLING decays the estimate by {@link VELOCITY_DECAY_FACTOR} (gradual, not an instant
 * snap) — a mid-fling pause must not erode the buffer before the next hard jump. The settle commit
 * (`isScrolling` flips to false: native `scrollend`, or the 150ms debounce fallback) is different in
 * kind from a mid-scroll pause: the user has stopped, not paused, so it hard-resets the estimate to 0
 * (see the `!isScrolling` branch below) instead of relying on decay-while-scrolling, which never runs
 * again once no further scroll tick arrives — the original design left the window stuck at its
 * fling-time size indefinitely at rest (tablecn comparison report, 2026-07-17: measured 59 rows
 * mounted and unchanged after scroll stop). A new scroll right after settle starts this estimator
 * fresh via {@link createVelocityEstimator}'s same `{estimate: 0}` shape, so it ramps normally again.
 */
const VELOCITY_RAMP_TICKS = 3;

/** Multiplicative decay applied per still-scrolling tick whose delta doesn't trigger the ramp — ~2-3 such ticks erode a maxed-out estimate back near the floor. */
const VELOCITY_DECAY_FACTOR = 0.5;

/** Px cap on the leading-edge velocity buffer — the minimum that keeps the blank detector's random
 * 200-1500px thumb-drag deltas reliably covered (measured: 200-trial simulation fails below ~1500px,
 * clean at 1600px+); every px above that is pure full-swap FPS cost with no blank-coverage benefit
 * (spec 6c-8's sustained 800px/tick case never needs more than its own delta). Exported so
 * {@link useColumnWindow} shares the same cap. */
export const VELOCITY_OVERSCAN_CAP_PX = 1600;

/** Below this, a delta is sub-row jitter (e.g. a 1px scroll-position correction), not drag signal — must not itself trigger the ramp. */
const VELOCITY_TRIGGER_PX = 72;

export type VelocityEstimator = { estimate: number; lastTickAt: number; retryTimer: ReturnType<typeof setTimeout> | null };

export function createVelocityEstimator(): VelocityEstimator {
  return { estimate: 0, lastTickAt: 0, retryTimer: null };
}

/**
 * A settle commit (`isScrolling` false) only resets the estimate once this much real wall-clock
 * time has actually passed since the last scrolling tick — must be >= {@link ISSCROLLING_DEBOUNCE_MS}
 * so a genuine idle settle (native `scrollend` firing right after a real gesture ends, or our own
 * debounce fallback) reliably clears it, but a synthetic/discrete `scrollTop` write settles almost
 * instantly in real Chromium's own `scrollend` heuristic (confirmed: browser-mode blank-detector
 * test fires native `scrollend` after nearly every individual write, ~1 per tick, even at
 * requestAnimationFrame cadence) — without this gate, that per-tick "fake settle" would zero the
 * estimate between every real jump, undersizing the window for the next one and blanking (exactly
 * the failure mode the ramp-not-decay design was built to avoid, just moved to a new trigger).
 */
const SETTLE_RESET_MIN_IDLE_MS = 150;

/**
 * Feeds one tick's signed delta + scrolling state in, returns the current estimate (px). A settle
 * observation that arrives before the idle gate has elapsed (native `scrollend` can fire faster
 * than {@link SETTLE_RESET_MIN_IDLE_MS} after a genuinely-final real tick, not just after a
 * synthetic one) schedules exactly one retry for the remaining wait, via `setTimeout`, so a true
 * idle settle is never silently dropped just because it was observed slightly too early — this is
 * what keeps the DOM from getting stuck at fling size indefinitely (the original bug) without
 * reintroducing the "settle looks identical to a 1-tick pause" false positive that caused blanking.
 * `onIdleReset` fires when the retry actually zeroes the estimate with no caller re-observing it —
 * the hook uses it to trigger one more window recompute, since otherwise a reset with no further
 * scroll tick would update the estimate but never repaint the (now too-large) DOM window to match.
 */
export function updateVelocityEstimate(
  estimator: VelocityEstimator,
  delta: number,
  isScrolling: boolean,
  onIdleReset?: () => void,
): number {
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!isScrolling) {
    const idleMs = now - estimator.lastTickAt;
    if (idleMs >= SETTLE_RESET_MIN_IDLE_MS) {
      estimator.estimate = 0;
      if (estimator.retryTimer !== null) {
        clearTimeout(estimator.retryTimer);
        estimator.retryTimer = null;
      }
    } else if (estimator.retryTimer === null) {
      estimator.retryTimer = setTimeout(() => {
        estimator.retryTimer = null;
        // Re-check, don't blindly zero: a real tick may have arrived during the wait and moved
        // lastTickAt forward, in which case this is no longer a settle at all.
        if (performance.now() - estimator.lastTickAt >= SETTLE_RESET_MIN_IDLE_MS && estimator.estimate !== 0) {
          estimator.estimate = 0;
          onIdleReset?.();
        }
      }, SETTLE_RESET_MIN_IDLE_MS - idleMs);
    }
    return estimator.estimate;
  }
  estimator.lastTickAt = now;
  // Re-arm the settle retry from the tick itself, not only from a settle observation: the native
  // scrollend (which is what schedules the retry via the !isScrolling branch) fires right after
  // each tick and its commit can land before/without a retry still pending, and on a contended
  // runner the last scrollend's retry can be dropped so the window parks at fling size. Arming
  // from the tick guarantees a retry is always pending SETTLE_RESET_MIN_IDLE_MS past the LAST tick
  // — the re-check inside still gates on a real 150ms idle, so a continued scroll (next tick < 150ms)
  // clears it and no premature reset/blanking happens.
  if (estimator.retryTimer !== null) {
    clearTimeout(estimator.retryTimer);
    estimator.retryTimer = null;
  }
  estimator.retryTimer = setTimeout(() => {
    estimator.retryTimer = null;
    if (performance.now() - estimator.lastTickAt >= SETTLE_RESET_MIN_IDLE_MS && estimator.estimate !== 0) {
      estimator.estimate = 0;
      onIdleReset?.();
    }
  }, SETTLE_RESET_MIN_IDLE_MS);
  const magnitude = Math.abs(delta);
  if (magnitude >= VELOCITY_TRIGGER_PX) {
    const rampStep = VELOCITY_OVERSCAN_CAP_PX / VELOCITY_RAMP_TICKS;
    // Cap applies to the OBSERVED magnitude too — an outsized single jump (e.g. a scrollbar
    // teleport far bigger than any real drag tick) must still clamp, not blow straight past it.
    estimator.estimate = Math.min(VELOCITY_OVERSCAN_CAP_PX, Math.max(magnitude, estimator.estimate + rampStep));
  } else {
    estimator.estimate *= VELOCITY_DECAY_FACTOR;
  }
  return estimator.estimate;
}
