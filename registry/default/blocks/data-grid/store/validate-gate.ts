import { GateRun, type GateWatch } from "./gate-signal";
import { gateTrackerOf } from "./internal-actions";

/** Starts the `"validate"` gate for a batch that an async schema holds; it shows in `gatesPending` until it settles. */
export function holdValidateGate(store: object | undefined, watch?: GateWatch): GateRun {
  const run = new GateRun("validate", watch);
  if (store) gateTrackerOf(store)?.hold(run);
  return run;
}

/** Ends the run; `false` when it was aborted (`gateTimeoutMs`, Escape, a newer batch, a reset), so the held batch drops. */
export function settleValidateGate(store: object | undefined, run: GateRun): boolean {
  if (store) gateTrackerOf(store)?.settle(run);
  return !run.aborted;
}
