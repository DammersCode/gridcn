import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("importTs", () => {
  it("loads a .ts module from a script without the typeless-package warning", () => {
    const code = 'import("./scripts/docs-verify-lib.mjs").then((m) => m.importTs("lib/llms-tasks.ts")).then((m) => console.log(Array.isArray(m.LLMS_TASKS)))';
    const run = spawnSync(process.execPath, ["-e", code], { encoding: "utf8" });
    expect(run.stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
    expect(run.stdout.trim()).toBe("true");
  });
});
