import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCycles } from "../scripts/check-runtime-cycles.mjs";

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "cycles-"));
  mkdirSync(join(root, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "src", name), text);
  return { root, path: (name: string) => join(root, "src", name) };
}

describe("findCycles", () => {
  it("reports a runtime cycle once", () => {
    const p = project({ "a.ts": 'import { b } from "./b";\nexport const a = b;', "b.ts": 'import { a } from "./a";\nexport const b = a;' });
    expect(findCycles(p.root, [p.path("a.ts"), p.path("b.ts")])).toHaveLength(1);
  });

  it("ignores type-only imports", () => {
    const p = project({ "a.ts": 'import type { B } from "./b";\nexport type A = B;', "b.ts": 'import { type A } from "./a";\nexport type B = A;' });
    expect(findCycles(p.root, [p.path("a.ts"), p.path("b.ts")])).toEqual([]);
  });

  it("reads imports after a comment opener inside a string", () => {
    const p = project({ "a.ts": 'import { b } from "./b";\nexport const a = b;', "b.ts": 'export const accept = "image/*";\nexport const url = "https://x";\nexport { a } from "./a";\n/** doc */\nexport const b = 1;' });
    expect(findCycles(p.root, [p.path("a.ts"), p.path("b.ts")])).toHaveLength(1);
  });

  it("counts a default import next to type-only named imports", () => {
    const p = project({ "a.ts": 'import B, { type T } from "./b";\nexport const a = B;\nexport type U = T;', "b.ts": 'import { a } from "./a";\nexport default a;\nexport type T = 1;' });
    expect(findCycles(p.root, [p.path("a.ts"), p.path("b.ts")])).toHaveLength(1);
  });
});
