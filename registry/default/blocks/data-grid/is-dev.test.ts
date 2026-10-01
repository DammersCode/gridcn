// @vitest-environment node
import * as path from "node:path";
import * as vm from "node:vm";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { isDev } from "./is-dev";

describe("isDev", () => {
  it("is true when NODE_ENV is not production", () => {
    expect(isDev()).toBe(true); // vitest runs with NODE_ENV=test
  });

  it("is false when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDev()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("falls back to development when the process global is unavailable", () => {
    const real = globalThis.process;
    vi.stubGlobal("process", undefined);
    try {
      expect(isDev()).toBe(true);
    } finally {
      vi.stubGlobal("process", real);
    }
  });
});

describe("isDev in a bundled production build", () => {
  it("reports production when the bundler replaces process.env.NODE_ENV and no process global exists", async () => {
    const result = await build({
      entryPoints: [path.resolve(process.cwd(), "registry/default/blocks/data-grid/is-dev.ts")],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "isDevModule",
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "silent",
    });
    const code = result.outputFiles[0]?.text ?? "";
    expect(code).not.toContain("process.env.NODE_ENV");

    // A fresh vm context has no `process` global, like a browser bundle.
    const out: unknown = vm.runInNewContext(`${code}\nisDevModule.isDev();`, {});
    expect(out).toBe(false);
  });
});
