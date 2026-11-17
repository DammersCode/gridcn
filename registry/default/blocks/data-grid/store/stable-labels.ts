import { useLayoutEffect, useState } from "react";

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree => typeof value === "object" && value !== null;

function sameShape(a: unknown, b: unknown): boolean {
  if (typeof a === "function" && typeof b === "function") return true;
  if (!isTree(a) || !isTree(b)) return Object.is(a, b);
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameShape(a[key], b[key]));
}

function readPath(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => (isTree(node) ? node[key] : undefined), root);
}

function forward(source: unknown, latest: { current: unknown }, path: readonly string[]): unknown {
  if (typeof source === "function") return (...args: unknown[]) => (readPath(latest.current, path) as (...a: unknown[]) => unknown)(...args);
  if (!isTree(source)) return source;
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, forward(value, latest, [...path, key])]));
}

function publish(box: { current: unknown }, value: unknown): void {
  box.current = value;
}

/**
 * Keeps the labels object the same while only function identities change; each function label calls the
 * function of the latest render, so an inline function label neither rebuilds the view nor goes stale.
 */
export function useStableLabels<T>(labels: T): T {
  const [latest] = useState<{ current: unknown }>(() => ({ current: labels }));
  const [held, setHeld] = useState(() => ({ source: labels as unknown, stable: forward(labels, latest, []) }));
  useLayoutEffect(() => {
    publish(latest, labels);
  });
  if (sameShape(held.source, labels)) return held.stable as T;
  const next = { source: labels as unknown, stable: forward(labels, latest, []) };
  setHeld(next);
  return next.stable as T;
}
