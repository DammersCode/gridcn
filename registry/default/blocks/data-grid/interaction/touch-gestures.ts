export const TAP_SLOP_PX = 10;
export const DOUBLE_TAP_MS = 300;
export const LONG_PRESS_MS = 500;

export type TouchPoint = { x: number; y: number };
export type TouchSample = TouchPoint & { time: number };
export type TapSample = TouchSample & { key: string };

export function movedBeyondSlop(start: TouchPoint, point: TouchPoint): boolean {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  return dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX;
}

export function isTap(start: TouchSample, end: TouchSample): boolean {
  return !movedBeyondSlop(start, end) && end.time - start.time < LONG_PRESS_MS;
}

export function isDoubleTap(previous: TapSample | null, next: TapSample): boolean {
  return previous !== null && previous.key === next.key && next.time - previous.time <= DOUBLE_TAP_MS && !movedBeyondSlop(previous, next);
}

export type LongPressTimer = { arm: () => void; cancel: () => void };

export function createLongPressTimer(onFire: () => void): LongPressTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
  };
  const arm = () => {
    cancel();
    handle = setTimeout(() => {
      handle = null;
      onFire();
    }, LONG_PRESS_MS);
  };
  return { arm, cancel };
}
