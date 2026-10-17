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
