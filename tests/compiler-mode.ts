/** The React Compiler's memo cache slot, e.g. `$[0]` — absent unless the module was compiled. */
export const MEMO_CACHE = /\$\[\d+\]/;

// Browser projects report a name like "browser-compiled (chromium)", hence the prefix test.
const projectName =
  (globalThis as { __vitest_worker__?: { ctx?: { projectName?: string } } }).__vitest_worker__?.ctx
    ?.projectName ?? "";

/** True in the `-compiled` projects, so guards can assert the cache's presence AND its absence. */
export const expectsMemoCache = projectName.startsWith("unit-compiled") || projectName.startsWith("browser-compiled");
