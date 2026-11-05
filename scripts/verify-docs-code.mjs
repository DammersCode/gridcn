// Fails when a ts/tsx code block in content/docs does not type-check against the registry source.
// A block that is not a full sample carries `fragment="reason"` in its fence info: ```tsx fragment="JSX only".
// The first sample of a page is checked alone, without placeholder names; later blocks may use `data`, `columns` and similar free names.
// Usage: node scripts/verify-docs-code.mjs [--root <dir>] [--files a.mdx,b.mdx]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, codeBlocks, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";

const MAX_FRAGMENT_SHARE = 0.2;
const CHECKED_LANGS = new Set(["ts", "tsx", "typescript", "jsx", "js", "javascript"]);

const AMBIENT = `type Row = { id: string; [key: string]: any };
declare const columns: import("@/components/data-grid/data-grid").ColumnDef<any, any>[];
declare const data: any[];
declare const rows: any[];
declare const grid: Record<string, any>;
declare const api: Record<string, (...args: any[]) => any>;
declare function setRows(...args: any[]): void;
`;

const API_NAME = /^(use)?(DataGrid|isComposingKey|useDebounce)/;
const FREE_NAME_CODES = new Set(["TS2304", "TS2552", "TS2503", "TS2693", "TS18004"]);

/** Names the registry blocks export (declarations and `export { a, b }` lists). */
export function exportedNames(root) {
  const names = new Set();
  for (const file of ["blocks", "hooks", "lib"].flatMap((dir) => walk(join(root, "registry/default", dir), [".ts", ".tsx"]))) {
    const text = readLf(file);
    for (const m of text.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) for (const part of m[1].split(",")) names.add(part.trim().split(/\s+as\s+/).at(-1));
  }
  return names;
}

/** `fragment="reason"` -> reason; bare `fragment` -> ""; absent -> undefined. */
export function fragmentReason(meta) {
  const match = /\bfragment(?:=(?:"([^"]*)"|'([^']*)'))?/.exec(meta);
  return match ? (match[1] ?? match[2] ?? "") : undefined;
}

function writeProject(dir, up, ambient) {
  mkdirSync(dir, { recursive: true });
  if (ambient) writeFileSync(join(dir, "ambient.d.ts"), AMBIENT);
  const to = (path) => `${up}${path}`;
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      extends: to("tsconfig.json"),
      compilerOptions: {
        incremental: false,
        noEmit: true,
        plugins: [],
        noUnusedLocals: false,
        noImplicitAny: false,
        noPropertyAccessFromIndexSignature: false,
        noUncheckedIndexedAccess: false,
        paths: { "@/components/gridcn/*": [to("registry/default/hooks/*"), to("registry/default/lib/*")], "@/components/ui/*": [to("components/ui/*")], "@/components/*": [to("registry/default/blocks/*")], "@/lib/*": [to("lib/*")], "@/*": [to("*")] },
      },
      include: ["*.ts", "*.tsx"],
      exclude: [],
    }),
  );
}

function tscErrors(root, dir) {
  let output = "";
  try {
    execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(dir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", stdio: "pipe", maxBuffer: 1 << 28 });
  } catch (error) {
    output = String(error.stdout);
  }
  const byBlock = new Map();
  const syntactic = new Set();
  for (const line of output.split("\n")) {
    const match = /(block-\d+\.[jt]sx?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (!match || match[3] === "TS2347") continue;
    byBlock.set(match[1], [...(byBlock.get(match[1]) ?? []), { line: Number(match[2]), code: match[3], message: match[4] }]);
    if (/^TS(1\d{3}|17\d{3}|2657)$/.test(match[3])) syntactic.add(match[1]);
  }
  return { byBlock, syntactic };
}

export function run({ root = process.cwd(), files } = {}) {
  const contentDir = join(root, "content/docs");
  const pageFiles = files ? files.map((f) => join(root, f)) : walk(contentDir, [".mdx"]);
  const blocks = [];
  const failures = [];
  let fragments = 0;
  for (const file of pageFiles) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    const path = rel(root, file);
    let total = 0;
    let fragmentsHere = 0;
    for (const block of codeBlocks(body)) {
      if (!CHECKED_LANGS.has(block.lang)) continue;
      total++;
      const reason = fragmentReason(block.meta);
      const start = block.line + bodyOffset;
      const lang = block.lang.startsWith("j") ? "tsx" : block.lang === "typescript" ? "ts" : block.lang;
      if (reason === "") failures.push(`${path}:${start}: fragment needs a reason: fragment="why"`);
      if (reason !== undefined) {
        if (reason.startsWith("needs ")) {
          const pkg = reason.slice(6).trim();
          const packageName = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
          const specifiers = [...block.code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
          if (!specifiers.some((spec) => spec === pkg || spec.startsWith(`${pkg}/`))) failures.push(`${path}:${start}: the block does not import ${pkg}`);
          else if (existsSync(join(root, "node_modules", packageName))) failures.push(`${path}:${start}: ${pkg} is installed; remove the needs marker`);
          total--;
          const own = block.code.match(/^import\s[\s\S]*?\sfrom\s+["']@\/[^"']+["'];?/gm);
          if (own) blocks.push({ ...block, lang: "ts", code: own.join("\n"), file, path, start });
          continue;
        }
        fragments++;
        fragmentsHere++;
        const imports = block.code.match(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?/gm);
        if (imports) blocks.push({ ...block, lang: "ts", code: imports.join("\n"), file, path, start });
        continue;
      }
      blocks.push({ ...block, lang, file, path, start, first: !blocks.some((b) => b.file === file && b.first) });
    }
    if (fragmentsHere > 1 && fragmentsHere / total > MAX_FRAGMENT_SHARE) failures.push(`${path}: ${fragmentsHere} of ${total} code blocks are fragments; the limit is ${MAX_FRAGMENT_SHARE * 100}%`);
  }

  const exported = exportedNames(root);
  const base = join(root, ".next", `docs-snippets-${process.pid}-${randomBytes(4).toString("hex")}`);
  const mainDir = join(base, "main");
  const firstDir = join(base, "first");
  rmSync(base, { recursive: true, force: true });
  writeProject(mainDir, "../../../", true);
  writeProject(firstDir, "../../../", false);
  const byName = new Map();
  blocks.forEach((block, index) => {
    const name = `block-${index}.${block.lang}`;
    byName.set(name, block);
    writeFileSync(join(mainDir, name), `export {};\n${block.code}\n`);
    if (block.first) writeFileSync(join(firstDir, name), `export {};\n${block.code}\n`);
  });

  let errorsByBlock = new Map();
  if (blocks.length > 0) {
    // tsc reports no semantic errors while any file has a syntax error, so syntax failures leave the program first.
    const pass1 = tscErrors(root, mainDir);
    const syntaxErrors = new Map([...pass1.syntactic].map((name) => [name, pass1.byBlock.get(name)]));
    for (const name of pass1.syntactic) {
      rmSync(join(mainDir, name));
      rmSync(join(firstDir, name), { force: true });
    }
    // Free names are declared as any so that a later block still checks the API it does use.
    const pass2 = tscErrors(root, mainDir);
    for (const [name, errors] of pass2.byBlock) {
      const block = byName.get(name);
      if (block.first) continue;
      const free = [...new Set(errors.filter((e) => FREE_NAME_CODES.has(e.code)).map((e) => /'([^']+)'/.exec(e.message)?.[1]).filter(Boolean))];
      if (free.length === 0) continue;
      const unknownApi = free.filter((n) => API_NAME.test(n) && !exported.has(n));
      for (const n of unknownApi) failures.push(`${block.path}:${block.start}: ${n} is not exported by the registry source`);
      const preface = free.filter((n) => !unknownApi.includes(n)).map((n) => `declare const ${n}: any; type ${n} = any;`).join(" ");
      writeFileSync(join(mainDir, name), `export {}; ${preface}\n${block.code}\n`);
    }
    errorsByBlock = tscErrors(root, mainDir).byBlock;
    for (const [name, errors] of syntaxErrors) errorsByBlock.set(name, errors);
    if ([...byName.values()].some((b) => b.first)) {
      const firstErrors = tscErrors(root, firstDir);
      for (const [name, block] of byName) {
        if (!block.first) continue;
        errorsByBlock.delete(name);
        const errors = firstErrors.byBlock.get(name) ?? syntaxErrors.get(name);
        if (errors) errorsByBlock.set(name, errors);
      }
    }
  }
  rmSync(base, { recursive: true, force: true });

  let failing = 0;
  let external = 0;
  for (const [name, errors] of errorsByBlock) {
    const block = byName.get(name);
    const isRelative = (e) => /Cannot find module '\.{1,2}\//.test(e.message);
    if (errors.every((e) => e.code === "TS2307" && isRelative(e))) continue;
    if (errors.every((e) => e.code === "TS2307" && !/'@\//.test(e.message))) {
      external++;
      failures.push(`${block.path}:${block.start}: external package not installed in the repo; mark the block fragment="needs <package>" (${errors[0].message})`);
      continue;
    }
    failing++;
    const first = errors.find((e) => !(e.code === "TS2307" && isRelative(e))) ?? errors[0];
    failures.push(`${block.path}:${block.start + first.line - 2}: ${first.code} ${first.message}`);
  }
  return { name: "code", checked: blocks.length, fragments, failing, external, failures, warnings: [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const result = run({ root: process.argv.includes("--root") ? arg("--root") : process.cwd(), files: process.argv.includes("--files") ? arg("--files").split(",") : undefined });
  if (result.failures.length) {
    console.error(`docs code: ${result.failing} fail to compile, ${result.external} need an external package, of ${result.checked} blocks (${result.fragments} fragments)\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs code: ${result.checked} blocks compile (${result.fragments} fragments)`);
}
