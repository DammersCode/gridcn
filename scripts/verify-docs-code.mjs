// Fails when a ts/tsx code block in content/docs does not type-check against the registry source.
// A block that is not a full sample carries `fragment="reason"` in its fence info: ```tsx fragment="JSX only".
// Usage: node scripts/verify-docs-code.mjs [--root <dir>] [--files a.mdx,b.mdx]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, codeBlocks, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";

const AMBIENT = `type Row = { id: string; [key: string]: any };
declare const columns: import("@/components/data-grid/data-grid").ColumnDef<any, any>[];
declare const data: any[];
declare const rows: any[];
declare const grid: Record<string, any>;
declare const api: Record<string, (...args: any[]) => any>;
declare function setRows(...args: any[]): void;
`;

const API_NAME = /^(use)?(DataGrid|isComposingKey|useDebounce)/;

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

export function run({ root = process.cwd(), files } = {}) {
  const contentDir = join(root, "content/docs");
  const pageFiles = files ? files.map((f) => join(root, f)) : walk(contentDir, [".mdx"]);
  const blocks = [];
  const failures = [];
  let fragments = 0;
  for (const file of pageFiles) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    for (const block of codeBlocks(body)) {
      if (block.lang !== "ts" && block.lang !== "tsx") continue;
      const reason = fragmentReason(block.meta);
      const where = `${rel(root, file)}:${block.line + bodyOffset}`;
      if (reason === "") failures.push(`${where}: fragment needs a reason: fragment="why"`);
      if (reason !== undefined) {
        fragments++;
        const imports = block.code.match(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?/gm);
        if (imports) blocks.push({ ...block, lang: "ts", code: imports.join("\n"), where });
        continue;
      }
      blocks.push({ ...block, file, where, path: rel(root, file), start: block.line + bodyOffset, first: !blocks.some((b) => b.file === file && b.first) });
    }
  }

  const exported = exportedNames(root);
  const outDir = join(root, ".next", `docs-snippets-${process.pid}`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const byName = new Map();
  blocks.forEach((block, index) => {
    const name = `block-${index}.${block.lang}`;
    writeFileSync(join(outDir, name), `export {};\n${block.code}\n`);
    byName.set(name, block);
  });
  writeFileSync(join(outDir, "ambient.d.ts"), AMBIENT);
  writeFileSync(
    join(outDir, "tsconfig.json"),
    JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: {
        incremental: false,
        noEmit: true,
        plugins: [],
        noUnusedLocals: false,
        noImplicitAny: false,
        noPropertyAccessFromIndexSignature: false,
        noUncheckedIndexedAccess: false,
        paths: { "@/components/gridcn/*": ["../../registry/default/hooks/*", "../../registry/default/lib/*"], "@/components/ui/*": ["../../components/ui/*"], "@/components/*": ["../../registry/default/blocks/*"], "@/lib/*": ["../../lib/*"], "@/*": ["../../*"] },
      },
      include: ["*.ts", "*.tsx"],
      exclude: [],
    }),
  );

  let external = 0;
  const syntaxErrors = new Map();
  const errorsByBlock = new Map();
  const tsc = () => {
    try {
      execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(outDir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", stdio: "pipe", maxBuffer: 1 << 28 });
      return "";
    } catch (error) {
      return String(error.stdout);
    }
  };
  const collect = (output) => {
    const syntactic = new Set();
    for (const line of output.split("\n")) {
      const match = /(block-\d+\.tsx?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line);
      if (!match) continue;
      const list = errorsByBlock.get(match[1]) ?? [];
      if (match[3] === "TS2347") continue;
      list.push({ line: Number(match[2]), code: match[3], message: match[4] });
      errorsByBlock.set(match[1], list);
      if (/^TS(1\d{3}|17\d{3}|2657)$/.test(match[3])) syntactic.add(match[1]);
    }
    return syntactic;
  };
  if (blocks.length > 0) {
    // tsc reports no semantic errors while any file has a syntax error, so syntax failures leave the program first.
    const syntactic = collect(tsc());
    for (const name of syntactic) syntaxErrors.set(name, errorsByBlock.get(name));
    if (syntactic.size > 0) {
      for (const name of syntactic) rmSync(join(outDir, name));
    }
    // Free names are declared as any so that a fragment still checks the API it does use.
    errorsByBlock.clear();
    collect(tsc());
    for (const [name, errors] of errorsByBlock) {
      const free = [...new Set(errors.filter((e) => e.code === "TS2304" || e.code === "TS2552" || e.code === "TS2503" || e.code === "TS2693" || e.code === "TS18004").map((e) => /'([^']+)'/.exec(e.message)?.[1]).filter(Boolean))];
      if (free.length === 0) continue;
      const block = byName.get(name);
      if (block.first) continue;
      const unknownApi = free.filter((n) => API_NAME.test(n) && !exported.has(n));
      for (const n of unknownApi) failures.push(`${block.where}: ${n} is not exported by the registry source`);
      const preface = free.filter((n) => !unknownApi.includes(n)).map((n) => `declare const ${n}: any; type ${n} = any;`).join(" ");
      writeFileSync(join(outDir, name), `export {}; ${preface}
${block.code}
`);
    }
    errorsByBlock.clear();
    collect(tsc());
    for (const [name, errors] of syntaxErrors) errorsByBlock.set(name, errors);
  }
  rmSync(outDir, { recursive: true, force: true });
  let failing = 0;
  for (const [name, errors] of errorsByBlock) {
    const block = byName.get(name);
    const onlyExternal = errors.every((e) => e.code === "TS2307" && !/'@\//.test(e.message));
    if (onlyExternal) {
      external++;
      failures.push(`${block.where}: external package not installed in the repo; mark it fragment="needs <package>" (${errors[0].message})`);
      continue;
    }
    failing++;
    const first = errors[0];
    failures.push(`${block.path ?? block.where}:${(block.start ?? 0) + first.line - 2}: ${first.code} ${first.message}`);
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
