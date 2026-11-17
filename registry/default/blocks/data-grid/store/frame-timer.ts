/** One pending callback per animation frame; `setTimeout` stands in where there is no `requestAnimationFrame`. */
export type FrameTimer = {
  readonly pending: boolean;
  schedule(run: () => void): void;
  /** Returns whether a callback was pending. */
  cancel(): boolean;
};

export function createFrameTimer(): FrameTimer {
  let handle: { stop: () => void } | null = null;
  return {
    get pending() {
      return handle !== null;
    },
    schedule(run) {
      if (handle) return;
      const fire = () => {
        handle = null;
        run();
      };
      if (typeof requestAnimationFrame === "function") {
        const id = requestAnimationFrame(fire);
        handle = { stop: () => cancelAnimationFrame(id) };
      } else {
        const id = setTimeout(fire, 16);
        handle = { stop: () => clearTimeout(id) };
      }
    },
    cancel() {
      if (!handle) return false;
      handle.stop();
      handle = null;
      return true;
    },
  };
}
