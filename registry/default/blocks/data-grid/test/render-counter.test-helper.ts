// Import this module before anything that loads react-dom: the renderer reads the devtools hook once, at load.

type Fiber = {
  tag: number;
  type: { displayName?: string; name?: string; render?: { name?: string } } | null;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
};
type FiberRoot = { current: Fiber };

const FUNCTION_COMPONENT = 0;
const FORWARD_REF = 11;
const SIMPLE_MEMO_COMPONENT = 15;
const PERFORMED_WORK = 1;

const counts = new Map<string, number>();
let injected = false;

function componentName(fiber: Fiber): string | null {
  if (fiber.tag !== FUNCTION_COMPONENT && fiber.tag !== FORWARD_REF && fiber.tag !== SIMPLE_MEMO_COMPONENT) return null;
  const type = fiber.type;
  return type?.displayName ?? type?.name ?? type?.render?.name ?? null;
}

function countCommit(fiber: Fiber | null): void {
  for (let node = fiber; node !== null; node = node.sibling) {
    const name = componentName(node);
    if (name && node.flags & PERFORMED_WORK) counts.set(name, (counts.get(name) ?? 0) + 1);
    // A bailed-out subtree keeps its previous fibers and their stale flags; skip it.
    if (node.alternate === null || node.child !== node.alternate.child) countCommit(node.child);
  }
}

type DevtoolsHook = Record<string, unknown>;
const globalScope = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevtoolsHook };
const installedHook: DevtoolsHook = {
  supportsFiber: true,
  renderers: new Map(),
  inject: () => {
    injected = true;
    return 1;
  },
  checkDCE: () => {},
  onScheduleFiberRoot: () => {},
  onCommitFiberUnmount: () => {},
  onPostCommitFiberRoot: () => {},
  onCommitFiberRoot: (_id: number, root: FiberRoot) => {
    countCommit(root.current);
  },
};
if (!globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__) globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ = installedHook;

export type RenderTracker = {
  count(name: string): number;
  reset(): void;
  snapshot(): Record<string, number>;
};

/** Counts renders per component name across commits. Throws when another devtools hook is installed, or when react-dom never injected into this helper's hook (it loaded first). */
export function trackRenders(): RenderTracker {
  if (globalScope.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== installedHook) {
    throw new Error("render-counter: another devtools hook is installed; import this helper before react-dom");
  }
  if (!injected) {
    throw new Error("render-counter: react-dom did not inject into the hook; import this helper before react-dom");
  }
  counts.clear();
  return {
    count: (name) => counts.get(name) ?? 0,
    reset: () => counts.clear(),
    snapshot: () => Object.fromEntries(counts),
  };
}
