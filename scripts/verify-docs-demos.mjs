// Cross-checks <ComponentPreview> and <InstallCommand> in content/docs against the example registry and registry.json,
// and applies the demo rule: at most one demo per page unless the page is an example page.
// Usage: node scripts/verify-docs-demos.mjs [--root <dir>]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, frontField, lineOf, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";

const NO_DEMO_TYPES = new Set(["reference", "concept", "step", "cheatsheet", "landing"]);
const readList = (file) => (existsSync(file) ? readLf(file).split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean) : []);

export function run({ root = process.cwd(), strictRules = false } = {}) {
  const registryText = readLf(join(root, "components/registry-examples.tsx"));
  const registered = new Set([...registryText.matchAll(/^\s*"([\w-]+)":\s*dynamic\(/gm)].map((m) => m[1]));
  const internal = new Set(readList(join(root, "scripts/docs-demos-internal.txt")));
  const items = new Set(JSON.parse(readLf(join(root, "registry.json"))).items.map((i) => i.name));
  const failures = [];
  const warnings = [];
  const used = new Map();
  const perPage = [];
  for (const file of walk(join(root, "content/docs"), [".mdx"])) {
    const { front, body, bodyOffset } = splitFrontmatter(readLf(file));
    const where = (index) => `${rel(root, file)}:${lineOf(body, index) + bodyOffset}`;
    const names = [];
    for (const m of body.matchAll(/<ComponentPreview\s+name=["']([\w-]+)["']/g)) {
      names.push(m[1]);
      used.set(m[1], (used.get(m[1]) ?? 0) + 1);
      if (!registered.has(m[1])) failures.push(`${where(m.index)}: demo ${m[1]} is not in components/registry-examples.tsx`);
    }
    for (const m of body.matchAll(/<InstallCommand\s+item=["']([\w-]+)["']/g)) if (!items.has(m[1])) failures.push(`${where(m.index)}: install item ${m[1]} is not in registry.json`);
    perPage.push({ file: rel(root, file), count: names.length, type: frontField(front, "type") });
  }
  for (const item of JSON.parse(readLf(join(root, "registry.json"))).items) {
    if (item.type === "registry:example" && !registered.has(item.name)) failures.push(`registry.json example ${item.name} is not in components/registry-examples.tsx`);
  }
  for (const name of registered) {
    if (!existsSync(join(root, "registry/default/examples", `${name}.tsx`))) failures.push(`registry-examples.tsx: ${name} has no file in registry/default/examples`);
    if (!used.has(name) && !internal.has(name)) failures.push(`demo ${name} is registered but no page embeds it (use it or list it in scripts/docs-demos-internal.txt)`);
  }
  let multi = 0;
  for (const page of perPage) {
    if (page.count > 1 && page.type !== "example" && !/^demos:\s*compare/m.test(readLf(join(root, page.file)))) {
      multi++;
      (strictRules ? failures : warnings).push(`${page.file}: ${page.count} demos; keep one, or add "demos: compare" to the frontmatter when the page compares variants`);
    }
    if (page.count > 0 && NO_DEMO_TYPES.has(page.type)) (strictRules ? failures : warnings).push(`${page.file}: a ${page.type} page embeds a demo`);
  }
  return { name: "demos", checked: [...used.values()].reduce((a, b) => a + b, 0), failures, warnings, stats: { registered: registered.size, multi } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = run({ root: process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd() });
  for (const w of capped(result.warnings, 4)) console.warn(`warn  ${w}`);
  if (result.failures.length) {
    console.error(`docs demos: ${result.failures.length} problems in ${result.checked} embeds, ${result.stats.registered} registered\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs demos: ${result.checked} embeds, ${result.stats.registered} registered, ${result.stats.multi} pages with several demos`);
}
