import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
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

// The production guarantee only exists after a bundler has replaced the literal: build a real
// Vite production app around the shipped file and run its output with no `process` global.
describe("isDev in a Vite production build", () => {
  it("reports production when Vite replaces the literal and process is absent at runtime", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gridcn-isdev-"));
    const source = fs.readFileSync(path.resolve(process.cwd(), "registry/default/blocks/data-grid/is-dev.ts"), "utf8");
    fs.writeFileSync(path.join(dir, "is-dev.ts"), source);
    fs.writeFileSync(path.join(dir, "entry.ts"), 'import { isDev } from "./is-dev";\nconsole.log("ISDEV:" + isDev());\n');
    fs.writeFileSync(path.join(dir, "index.html"), '<!doctype html>\n<script type="module" src="/entry.ts"></script>\n');
    // no config file: the default production build must replace `process.env.NODE_ENV` on its own.
    // Vite takes the replace value from `process.env.NODE_ENV || mode`, and vitest runs with
    // NODE_ENV=test — clear it so the build sees what a clean consumer build sees (mode only).
    const env = process.env as Record<string, string | undefined>;
    const savedNodeEnv = env["NODE_ENV"];
    delete env["NODE_ENV"];
    let built: Awaited<ReturnType<typeof import("vite").build>>;
    try {
      const { build } = await import("vite");
      built = await build({ root: dir, mode: "production", logLevel: "error", build: { outDir: "dist", emptyOutDir: true } });
    } finally {
      if (savedNodeEnv !== undefined) env["NODE_ENV"] = savedNodeEnv;
    }
    expect(built).toBeDefined();

    const chunkDir = path.join(dir, "dist", "assets");
    const chunks = fs.readdirSync(chunkDir).filter((f) => f.endsWith(".js"));
    for (const chunk of chunks) {
      expect(fs.readFileSync(path.join(chunkDir, chunk), "utf8")).not.toContain("process.env.NODE_ENV");
    }

    const out = await new Promise<string>((resolve, reject) => {
      const script = chunks
        .map((c) => `await import(${JSON.stringify(pathToFileURL(path.join(chunkDir, c)).href)});`)
        .join("\n");
      // the app chunk ships Vite's modulepreload polyfill; stub the three DOM bits it touches
      // so it runs in node, while `process` itself stays gone (the whole point of the check)
      const stubs =
        "globalThis.document = { createElement: () => ({ relList: { supports: () => false } }), querySelectorAll: () => [] };\n" +
        "globalThis.MutationObserver = class { observe() {} };\n";
      execFile(process.execPath, ["--input-type=module", "-e", `delete globalThis.process;\n${stubs}${script}`], (err, stdout) =>
        err ? reject(err) : resolve(stdout.trim()),
      );
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(out).toBe("ISDEV:false");
  });
});
