// Fails when a ts/tsx code block in content/docs does not type-check against the registry source.
// A block that is not a full sample carries `fragment="reason"` in its fence info: ```tsx fragment="JSX only".
// A block that imports packages the repo lacks carries `fragment="needs <pkg> [<pkg>...]"`; it compiles in full with each package as an untyped module.
// The first sample of a page is checked alone; later blocks may also use `data`, `columns`, `rows`, `grid`, `api`, `setRows` and `Row`. Any other free name fails.
// Every sample compiles under `strict`, noImplicitAny included.
// scripts/docs-code-pending.txt lists samples that fail today: `<page>#<n> fix-pending WP-nn`, where n is the 1-based position among the page's ts/tsx/js code blocks.
// A pending sample that fails stays green. One that passes, or no longer exists, is a stale entry and fails the run.
// Usage: node scripts/verify-docs-code.mjs [--root <dir>] [--files a.mdx,b.mdx]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const SHIM_TYPE_CODES = new Set(["TS2709", "TS2694"]);

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

const PENDING_ENTRY = /^(\S+)#(\d+)\s+fix-pending\s+(WP-\d+)$/;

/** Parses the pending list; a line is `<page>#<n> fix-pending WP-nn`, and `#` at line start opens a comment. */
export function parsePending(text) {
  const entries = new Map();
  const problems = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const m = PENDING_ENTRY.exec(line);
    if (m) entries.set(`${m[1]}#${m[2]}`, m[3]);
    else problems.push(`scripts/docs-code-pending.txt:${i + 1}: write "<page>#<n> fix-pending WP-nn"`);
  });
  return { entries, problems };
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
        noImplicitAny: true,
        noPropertyAccessFromIndexSignature: false,
        noUncheckedIndexedAccess: false,
        paths: { "@/components/gridcn/*": [to("registry/default/hooks/*"), to("registry/default/lib/*")], "@/components/ui/*": [to("components/ui/*")], "@/components/*": [to("registry/default/blocks/*")], "@/lib/*": [to("lib/*")], "@/*": [to("*")] },
      },
      include: ["*.ts", "*.tsx"],
      exclude: [],
    }),
  );
}

/** Parses `tsc --pretty false` output; CRLF output (Windows) parses like LF. */
export function parseTscOutput(output) {
  const byBlock = new Map();
  const syntactic = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /(block-\d+\.[jt]sx?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
    if (!match || match[3] === "TS2347") continue;
    byBlock.set(match[1], [...(byBlock.get(match[1]) ?? []), { line: Number(match[2]), code: match[3], message: match[4] }]);
    if (/^TS(1\d{3}|17\d{3}|2657)$/.test(match[3])) syntactic.add(match[1]);
  }
  return { byBlock, syntactic };
}

/** The TypeScript 7 compiler of the repo and, when installed, the TypeScript 5.9 one that consumers run. */
export function tscCompilers(root) {
  const ts5 = join(root, "node_modules", ".pnpm", "typescript@5.9.3", "node_modules", "typescript", "bin", "tsc");
  return [join(root, "node_modules", "typescript", "bin", "tsc"), ...(existsSync(ts5) ? [ts5] : [])];
}

function tscOnce(compiler, dir) {
  try {
    execFileSync(process.execPath, [compiler, "-p", join(dir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", stdio: "pipe", maxBuffer: 1 << 28 });
    return "";
  } catch (error) {
    return String(error.stdout);
  }
}

function tscErrors(compilers, dir) {
  const byBlock = new Map();
  const syntactic = new Set();
  for (const compiler of compilers) {
    const parsed = parseTscOutput(tscOnce(compiler, dir));
    for (const [name, errors] of parsed.byBlock) {
      const seen = byBlock.get(name) ?? [];
      const fresh = errors.filter((e) => !seen.some((s) => s.code === e.code && s.line === e.line));
      byBlock.set(name, [...seen, ...fresh]);
    }
    for (const name of parsed.syntactic) syntactic.add(name);
  }
  return { byBlock, syntactic };
}

export function run({ root = process.cwd(), files, pendingText, compilers = tscCompilers(root) } = {}) {
  const contentDir = join(root, "content/docs");
  const pageFiles = files ? files.map((f) => join(root, f)) : walk(contentDir, [".mdx"]);
  const blocks = [];
  const failures = [];
  const externalModules = new Set();
  let fragments = 0;
  const pendingFile = join(root, "scripts/docs-code-pending.txt");
  const pendingList = parsePending(pendingText ?? (existsSync(pendingFile) ? readFileSync(pendingFile, "utf8") : ""));
  failures.push(...pendingList.problems);
  for (const file of pageFiles) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    const path = rel(root, file);
    let total = 0;
    let ordinal = 0;
    let fragmentsHere = 0;
    for (const block of codeBlocks(body)) {
      if (!CHECKED_LANGS.has(block.lang)) continue;
      total++;
      ordinal++;
      const key = `${path}#${ordinal}`;
      const reason = fragmentReason(block.meta);
      const start = block.line + bodyOffset;
      const lang = block.lang.startsWith("j") ? "tsx" : block.lang === "typescript" ? "ts" : block.lang;
      if (reason === "") failures.push(`${path}:${start}: fragment needs a reason: fragment="why"`);
      if (reason !== undefined) {
        if (reason.startsWith("needs ")) {
          const pkgs = reason.slice(6).trim().split(/\s+/);
          const fromPkg = (spec) => pkgs.some((pkg) => spec === pkg || spec.startsWith(`${pkg}/`));
          const specifiers = [...block.code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
          for (const pkg of pkgs) {
            const packageName = pkg.startsWith("@") ? pkg.split("/").slice(0, 2).join("/") : pkg.split("/")[0];
            if (!specifiers.some((spec) => spec === pkg || spec.startsWith(`${pkg}/`))) failures.push(`${path}:${start}: the block does not import ${pkg}`);
            else if (existsSync(join(root, "node_modules", packageName))) failures.push(`${path}:${start}: ${pkg} is installed; remove the needs marker`);
            externalModules.add(pkg);
          }
          const externalNames = [...block.code.matchAll(/^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm)].filter((m) => fromPkg(m[2])).flatMap((m) => m[1].match(/[A-Za-z_$][\w$]*/g) ?? []);
          total--;
          blocks.push({ ...block, lang, file, path, start, key, first: !blocks.some((b) => b.file === file && b.first), externalNames, externalPkgs: pkgs });
          continue;
        }
        fragments++;
        fragmentsHere++;
        const imports = block.code.match(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?/gm);
        if (imports) blocks.push({ ...block, lang: "ts", code: imports.join("\n"), file, path, start });
        continue;
      }
      if (/^\s*declare\s+(?:function|const|let|var|class)\b/m.test(block.code)) failures.push(`${path}:${start}: a declare statement is a placeholder that throws when pasted; write the real code or mark the block as a fragment`);
      blocks.push({ ...block, lang, file, path, start, key, first: !blocks.some((b) => b.file === file && b.first) });
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
  // A `needs` package is not installed: it type-checks as an untyped module, so the rest of the sample still checks.
  const shims = [...externalModules].map((pkg) => `declare module "${pkg}";\ndeclare module "${pkg}/*";`).join("\n");
  for (const dir of [mainDir, firstDir]) writeFileSync(join(dir, "external-modules.d.ts"), shims);
  const byName = new Map();
  blocks.forEach((block, index) => {
    const name = `block-${index}.${block.lang}`;
    byName.set(name, block);
    writeFileSync(join(mainDir, name), `export {};\n${block.code}\n`);
    if (block.first) writeFileSync(join(firstDir, name), `export {};\n${block.code}\n`);
  });

  let errorsByBlock = new Map();
  const unknownApi = new Map();
  if (blocks.length > 0) {
    // tsc reports no semantic errors while any file has a syntax error, so syntax failures leave the program first.
    const pass1 = tscErrors(compilers, mainDir);
    const syntaxErrors = new Map([...pass1.syntactic].map((name) => [name, pass1.byBlock.get(name)]));
    for (const name of pass1.syntactic) {
      rmSync(join(mainDir, name));
      rmSync(join(firstDir, name), { force: true });
    }
    errorsByBlock = tscErrors(compilers, mainDir).byBlock;
    for (const [name, errors] of errorsByBlock) {
      const block = byName.get(name);
      if (block.first) continue;
      const free = new Set(errors.filter((e) => FREE_NAME_CODES.has(e.code)).map((e) => /'([^']+)'/.exec(e.message)?.[1]));
      for (const n of free) if (n && API_NAME.test(n) && !exported.has(n)) unknownApi.set(name, [...(unknownApi.get(name) ?? []), `${block.path}:${block.start}: ${n} is not exported by the registry source`]);
    }
    for (const [name, errors] of syntaxErrors) errorsByBlock.set(name, errors);
    if ([...byName.values()].some((b) => b.first)) {
      const firstErrors = tscErrors(compilers, firstDir);
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
  let pendingCount = 0;
  const pendingSeen = new Set();
  const reportBlock = (block, messages, isExternal = false) => {
    if (pendingList.entries.has(block.key)) {
      pendingSeen.add(block.key);
      pendingCount++;
      return;
    }
    failures.push(...messages.map((m) => `${m} [${block.key}]`));
    if (isExternal) external++;
    else failing++;
  };
  for (const [name, allErrors] of errorsByBlock) {
    const block = byName.get(name);
    if (unknownApi.has(name)) {
      reportBlock(block, unknownApi.get(name));
      continue;
    }
    // An untyped module has no type members, so a type use of its names is not the sample's fault.
    const shimTypeError = (e) => SHIM_TYPE_CODES.has(e.code) && ((block.externalNames ?? []).some((n) => e.message.includes(`'${n}'`)) || (block.externalPkgs ?? []).some((p) => e.message.includes(`"${p}`)));
    const errors = allErrors.filter((e) => !shimTypeError(e));
    if (errors.length === 0) continue;
    const isRelative = (e) => /Cannot find module '(?:\.{1,2}|~)\//.test(e.message);
    if (errors.every((e) => e.code === "TS2307" && isRelative(e))) continue;
    if (errors.every((e) => e.code === "TS2307" && !/'@\//.test(e.message))) {
      reportBlock(block, [`${block.path}:${block.start}: external package not installed in the repo; mark the block fragment="needs <package>" (${errors[0].message})`], true);
      continue;
    }
    const first = errors.find((e) => !(e.code === "TS2307" && isRelative(e))) ?? errors[0];
    reportBlock(block, [`${block.path}:${block.start + first.line - 2}: ${first.code} ${first.message}`]);
  }
  const checkedPages = new Set(pageFiles.map((f) => rel(root, f)));
  for (const key of pendingList.entries.keys()) {
    if (!pendingSeen.has(key) && checkedPages.has(key.replace(/#\d+$/, ""))) failures.push(`${key}: stale pending entry, the sample compiles or no longer exists; remove the line from scripts/docs-code-pending.txt`);
  }
  return { name: "code", checked: blocks.length, fragments, failing, external, pending: pendingCount, failures, warnings: [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const result = run({ root: process.argv.includes("--root") ? arg("--root") : process.cwd(), files: process.argv.includes("--files") ? arg("--files").split(",") : undefined });
  if (result.failures.length) {
    console.error(`docs code: ${result.failing} fail to compile, ${result.external} need an external package, of ${result.checked} blocks (${result.fragments} fragments)\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs code: ${result.checked} blocks compile (${result.fragments} fragments, ${result.pending} pending a docs fix)`);
}
