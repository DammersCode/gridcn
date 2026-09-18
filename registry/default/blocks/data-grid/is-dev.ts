/** True outside production; reads `process.env.NODE_ENV` via `globalThis` so it typechecks without `@types/node` (Vite consumers don't have it by default). */
export function isDev(): boolean {
  const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return env !== "production";
}
