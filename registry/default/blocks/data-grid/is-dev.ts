// file-local declaration, so the literal below typechecks in consumers without @types/node
declare const process: { env: { NODE_ENV?: string } };

/** True outside production builds. */
export function isDev(): boolean {
  // Bundlers replace only the bare literal; the catch covers a build that skips it and has no `process`.
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

export function warnDev(message: string): void {
  if (isDev()) console.warn(`[data-grid] ${message}`);
}

/** A dev warning that fires once per key for the lifetime of the returned function. */
export function createWarnOnce(): (key: string, message: string | (() => string)) => void {
  const warned = new Set<string>();
  return (key, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnDev(typeof message === "function" ? message() : message);
  };
}
