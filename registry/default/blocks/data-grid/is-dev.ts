// file-local declaration, so the literal below typechecks in consumers without @types/node
declare const process: { env: { NODE_ENV?: string } };

/**
 * True outside production. The literal `process.env.NODE_ENV` is replaced by bundlers
 * (webpack, Vite, Next) before it can run, so no `process` global exists at runtime; the catch
 * keeps builds that skip the replacement on the development side instead of crashing.
 */
export function isDev(): boolean {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}
