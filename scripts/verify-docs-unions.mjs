// Fails when a docs page lists the members of a code union by hand and the list drifts from the source.
// scripts/docs-unions.json names each union (type alias, property type, or const array), the page, and the page text that lists it.
// A page "lists" a member as a code span (`x`) or a quoted string ("x") inside the scope: the line of `marker`, or the section of `heading`.
// scripts/docs-unions-baseline.json lists drift that exists today; an entry that no longer drifts fails as stale.
// Usage: node scripts/verify-docs-unions.mjs [--root <dir>]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, readLf } from "./docs-verify-lib.mjs";

const IDENT = /^[A-Za-z_$][\w$]*/;
const MEMBER_LIKE = /^[A-Za-z][\w-]*$/;

/** Splits `text` at depth-0 occurrences of any char in `stops`; returns [head, restIndex]. */
function takeUntil(text, start, stops) {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{<".includes(c) && !(c === "<" && text[i - 1] === " ")) depth++;
    else if (")]}>".includes(c) && !(c === ">" && text[i - 1] === "=")) {
      if (depth === 0) return text.slice(start, i);
      depth--;
    } else if (depth === 0 && stops.includes(c)) return text.slice(start, i);
  }
  return text.slice(start);
}

function splitAlternatives(rhs) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let from = 0;
  for (let i = 0; i < rhs.length; i++) {
    const c = rhs[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{<".includes(c)) depth++;
    else if (")]}>".includes(c) && rhs[i - 1] !== "=") depth--;
    else if (c === "|" && depth === 0) {
      parts.push(rhs.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(rhs.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function constArray(source, name) {
  const m = new RegExp(`\\b(?:const|let)\\s+${name}\\b[^=]*=\\s*\\[`).exec(source);
  if (!m) return null;
  const body = takeUntil(source, m.index + m[0].length, "]");
  return [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((x) => x[1] ?? x[2]);
}

function aliasRhs(source, name) {
  const m = new RegExp(`\\btype\\s+${name}\\b(?:<[^=]*>)?\\s*=`).exec(source);
  return m ? takeUntil(source, m.index + m[0].length, ";") : null;
}

function propertyRhs(source, typeName, member) {
  const start = source.search(new RegExp(`\\b(?:type|interface)\\s+${typeName}\\b`));
  if (start < 0) return null;
  const m = new RegExp(`\\b${member}\\??:\\s*`).exec(source.slice(start));
  return m ? takeUntil(source, start + m.index + m[0].length, ";,") : null;
}

/** Literal members of a union written as strings, `reorder-${Other}` templates, other aliases of the same sources, or `typeof ARR[number]`. */
export function unionMembers(sources, rhs, seen = new Set()) {
  const out = [];
  for (const alt of splitAlternatives(rhs)) {
    const str = /^(?:"([^"]*)"|'([^']*)')$/.exec(alt);
    if (str) {
      out.push(str[1] ?? str[2]);
      continue;
    }
    const typeofArr = /^\(?typeof\s+(\w+)\)?\[number\]$/.exec(alt);
    if (typeofArr) {
      for (const source of sources) out.push(...(constArray(source, typeofArr[1]) ?? []));
      continue;
    }
    const template = /^`([^`]*)`$/.exec(alt);
    if (template) {
      let variants = [""];
      for (const piece of template[1].split(/(\$\{[^}]+\})/)) {
        const ref = /^\$\{(\w+)\}$/.exec(piece);
        const options = ref ? aliasMembers(sources, ref[1], seen) : [piece];
        variants = variants.flatMap((v) => options.map((o) => v + o));
      }
      out.push(...variants);
      continue;
    }
    const ref = IDENT.exec(alt);
    if (ref && ref[0] === alt) out.push(...aliasMembers(sources, alt, seen));
  }
  return out;
}

function aliasMembers(sources, name, seen) {
  if (seen.has(name)) return [];
  seen.add(name);
  const rhs = sources.map((source) => aliasRhs(source, name)).find((r) => r !== null);
  const members = rhs === undefined ? [] : unionMembers(sources, rhs, seen);
  seen.delete(name);
  return members;
}

/** Resolves a manifest entry's union (plus, with `collect`, the ids the source builds by `pattern` that the declared type lacks): `type`, `type` + `member`, or `const`; `via` names extra files that hold referenced aliases. */
export function resolveEntry(root, entry) {
  const members = resolveDeclared(root, entry);
  if (!entry.collect) return members;
  const text = readLf(join(root, entry.collect.file));
  return [...new Set([...members, ...[...text.matchAll(new RegExp(entry.collect.pattern, "g"))].map((m) => m[1])])];
}

function resolveDeclared(root, entry) {
  const sources = [entry.file, ...(entry.via ?? [])].map((f) => readLf(join(root, f)));
  const main = sources[0];
  if (entry.const) {
    const list = constArray(main, entry.const);
    if (!list) throw new Error(`${entry.id}: const ${entry.const} not found in ${entry.file}`);
    return list;
  }
  const rhs = entry.member ? propertyRhs(main, entry.type, entry.member) : aliasRhs(main, entry.type);
  if (rhs === null) throw new Error(`${entry.id}: ${entry.type}${entry.member ? `.${entry.member}` : ""} not found in ${entry.file}`);
  const members = [...new Set(unionMembers(sources, rhs))];
  if (members.length === 0) throw new Error(`${entry.id}: no literal members resolved from ${entry.type}`);
  return members;
}

/** The page text an entry lists its union in: the paragraph of `marker`, or the section under `heading`. */
export function scopeOf(pageText, entry) {
  const lines = pageText.split("\n");
  let from = 0;
  let to = lines.length;
  if (entry.heading) {
    const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s+/, "").replace(/\s*\[#[^\]]*\]\s*$/, "").trim() === entry.heading);
    if (at < 0) return null;
    const level = /^#+/.exec(lines[at])[0].length;
    from = at + 1;
    const next = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)[0].length <= level);
    to = next < 0 ? lines.length : next;
  }
  if (entry.marker) {
    const at = lines.findIndex((l, i) => i >= from && i < to && l.includes(entry.marker));
    if (at < 0) return null;
    let end = at + 1;
    const stops = entry.block ? /^#/ : /^\s*(?:[-*]|\d+\.)\s|^\||^#/;
    while (end < to && lines[end].trim() !== "" && !stops.test(lines[end])) end++;
    return lines.slice(at, end).join("\n");
  }
  return lines.slice(from, to).join("\n");
}

export function listedTokens(scope, column) {
  const tokens = new Set();
  const lines = scope.split("\n");
  const text = column ? lines.filter((l, i) => l.startsWith("|") && !/^\|[\s:|-]+\|$/.test(lines[i + 1] ?? "")).map((l) => l.split(/(?<!\x5c)\|/)[column] ?? "").join("\n") : scope;
  for (const m of text.matchAll(/`([^`\n]+)`|"([^"\n]+)"/g)) {
    const token = (m[1] ?? m[2]).trim();
    tokens.add(token);
    if (m[1] !== undefined) for (const inner of token.matchAll(/"([^"]*)"|'([^']*)'/g)) tokens.add(inner[1] ?? inner[2]);
  }
  for (const token of tokens) if (/^'[^']*'$/.test(token)) tokens.add(token.slice(1, -1));
  return tokens;
}

export function checkEntry(root, entry) {
  const members = resolveEntry(root, entry).filter((m) => !(entry.omit ?? []).includes(m));
  const file = join(root, entry.page);
  if (!existsSync(file)) return { entry, problem: `page ${entry.page} does not exist` };
  const scope = scopeOf(readLf(file), entry);
  if (scope === null) return { entry, problem: `${entry.page}: the ${entry.heading ? `heading "${entry.heading}"` : `marker "${entry.marker}"`} is not on the page` };
  const listed = listedTokens(scope, entry.column);
  const known = new Set(resolveEntry(root, entry));
  const allow = new Set(entry.allow ?? []);
  const missing = members.filter((m) => !listed.has(m));
  const unknown = [...listed].filter((t) => MEMBER_LIKE.test(t) && !known.has(t) && !allow.has(t));
  return { entry, missing, unknown };
}

const describe = (r) => `${r.entry.page} [${r.entry.id}]${r.missing.length ? ` lacks ${r.missing.join(", ")}` : ""}${r.unknown.length ? ` lists ${r.unknown.join(", ")}, which the source does not have` : ""}`;
const keyOf = (r) => JSON.stringify({ id: r.entry.id, missing: r.missing, unknown: r.unknown });

export function run({ root = process.cwd(), manifest, baseline } = {}) {
  const read = (rel, fallback) => {
    const file = join(root, rel);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
  };
  const entries = manifest ?? read("scripts/docs-unions.json", []);
  const known = baseline ?? read("scripts/docs-unions-baseline.json", []);
  const baselineKeys = new Set(known.map((b) => JSON.stringify({ id: b.id, missing: b.missing, unknown: b.unknown })));
  const failures = [];
  const drifted = [];
  const seenIds = new Set();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) failures.push(`scripts/docs-unions.json: duplicate id ${entry.id}`);
    seenIds.add(entry.id);
    let result;
    try {
      result = checkEntry(root, entry);
    } catch (error) {
      failures.push(`scripts/docs-unions.json: ${error.message}`);
      continue;
    }
    if (result.problem) {
      failures.push(`scripts/docs-unions.json: ${entry.id}: ${result.problem}`);
      continue;
    }
    if (result.missing.length || result.unknown.length) drifted.push(result);
  }
  const driftKeys = new Set(drifted.map(keyOf));
  for (const r of drifted) if (!baselineKeys.has(keyOf(r))) failures.push(describe(r));
  for (const b of known) if (!driftKeys.has(JSON.stringify({ id: b.id, missing: b.missing, unknown: b.unknown }))) failures.push(`scripts/docs-unions-baseline.json: ${b.id} no longer drifts or changed; remove or update the entry (${b.page})`);
  return { name: "unions", checked: entries.length, drifted, failures, warnings: [] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.argv.includes("--root") ? process.argv[process.argv.indexOf("--root") + 1] : process.cwd();
  if (process.argv.includes("--write-baseline")) {
    const entries = JSON.parse(readFileSync(join(root, "scripts/docs-unions.json"), "utf8"));
    const rows = entries.map((e) => checkEntry(root, e)).filter((r) => r.missing?.length || r.unknown?.length).map((r) => ({ id: r.entry.id, page: r.entry.page, missing: r.missing, unknown: r.unknown }));
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    process.exit(0);
  }
  const result = run({ root });
  if (result.failures.length) {
    console.error(`docs unions: ${result.failures.length} problems in ${result.checked} unions\n${capped(result.failures, process.argv.includes("--all") ? 999 : undefined).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs unions: ${result.checked} unions match their pages (${result.drifted.length} baselined)`);
}
