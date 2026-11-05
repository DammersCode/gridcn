// Compares every props table in content/docs with the TypeScript types in registry/default.
// A table is pinned to its types by a marker on the line above: {/* props: DataGridToolbarOptions */}.
// An unmarked table is matched by the best name overlap and counted as "guessed".
// Usage: node scripts/verify-docs-props.mjs [--strict] [--root <dir>]
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, proseOnly, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";
import { isTestFile } from "./_lib.mjs";

const NAME_HEADERS = new Set(["prop", "props", "option", "options", "property", "field", "key", "name", "parameter", "result", "member", "returns"]);

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|\s)\/\/.*$/gm, "$1");

function matchClose(text, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c in pairs) depth++;
    else if (c === "}" || c === ")" || c === "]") if (--depth === 0) return i;
  }
  return -1;
}

function skipString(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === quote) return i;
  }
  return text.length;
}

/** Top-level members of an object type body: `name -> { optional, type }`. `open` is true when an index signature or spread-like member hides names. */
export function parseMembers(body) {
  const members = new Map();
  let open = false;
  const parts = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(body, i);
      current += body.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === "=" && body[i + 1] === ">") {
      current += "=>";
      i++;
      continue;
    }
    if ("{([<".includes(c)) depth++;
    else if ("})]>".includes(c)) depth--;
    if (depth === 0 && (c === ";" || c === ",")) {
      flush();
      continue;
    }
    if (depth === 0 && c === "\n") {
      const rest = body.slice(i + 1).trimStart();
      if (current.trim() && !/[|&:=>,<([{]$/.test(current.trim()) && !/^[|&?:.=]/.test(rest)) flush();
      else current += " ";
      continue;
    }
    current += c;
  }
  flush();
  for (const part of parts) {
    const match = /^(?:readonly\s+)?(?:["']([^"']+)["']|([A-Za-z_$][\w$]*))(\?)?\s*(?:[:(<]|$)/.exec(part);
    if (!match) {
      open = true;
      continue;
    }
    members.set(match[1] ?? match[2], { optional: Boolean(match[3]), type: part.replace(/^[^:(<]*[:]?/, "").trim() });
  }
  return { members, open };
}

/** Every `interface X` and object-literal `type X =` of a source text: `{ name, members, extends, open }`. */
export function parseTypes(raw) {
  const text = stripComments(raw);
  const defs = [];
  const push = (name, owners, bases, open) => {
    const members = new Map();
    for (const body of owners) {
      const parsed = parseMembers(body);
      open ||= parsed.open;
      for (const [k, v] of parsed.members) members.set(k, v);
    }
    defs.push({ name, members, extends: bases, open });
  };
  for (const m of text.matchAll(/\binterface\s+([A-Z]\w*)\s*(?:<[^{]*?>)?\s*(?:extends\s+([^{]+?))?\s*\{/g)) {
    const brace = m.index + m[0].length - 1;
    const close = matchClose(text, brace);
    if (close < 0) continue;
    const bases = (m[2] ? splitTop(m[2], ",") : []).map((b) => b.trim().replace(/<.*$/s, "")).filter(Boolean);
    push(m[1], [text.slice(brace + 1, close)], bases, false);
  }
  for (const m of text.matchAll(/\btype\s+([A-Z]\w*)\s*(?:<[^=]*?>)?\s*=\s*/g)) {
    const start = m.index + m[0].length;
    let depth = 0;
    let stop = text.length;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if ("{([<".includes(c)) depth++;
      else if (c === "=" && text[i + 1] === ">") i++;
      else if ("})]>".includes(c)) depth--;
      else if ((c === ";" || c === "\n") && depth <= 0 && !/[&|]\s*$/.test(text.slice(start, i)) && !/^\s*[&|]/.test(text.slice(i + 1))) {
        stop = i;
        break;
      }
    }
    const owners = [];
    const bases = [];
    let open = false;
    for (const part of splitTop(text.slice(start, stop), "&")) {
      const piece = part.trim();
      if (piece.startsWith("{")) owners.push(piece.slice(1, matchClose(piece, 0)));
      else if (/^[A-Z]\w*$/.test(piece)) bases.push(piece);
      else open = true;
    }
    if (owners.length > 0 || bases.length > 0) push(m[1], owners, bases, open);
    else {
      const pick = /^Pick<\s*([A-Z]\w*)\s*,\s*([^>]+)>$/.exec(text.slice(start, stop).trim());
      defs.push({ name: m[1], members: new Map(), extends: [], open: !pick, pick: pick ? { from: pick[1], keys: [...pick[2].matchAll(/["']([^"']+)["']/g)].map((k) => k[1]) } : undefined });
    }
  }
  return defs;
}

function splitTop(expr, sep) {
  const out = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if ("{([<".includes(c)) depth++;
    else if (c === "=" && expr[i + 1] === ">") {
      current += "=>";
      i++;
      continue;
    } else if ("})]>".includes(c)) depth--;
    if (c === sep && depth === 0) {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out;
}

export function sourceIndex(root) {
  const defs = [];
  const dirs = ["blocks", "hooks", "lib"].map((d) => join(root, "registry/default", d));
  for (const file of dirs.flatMap((dir) => walk(dir, [".ts", ".tsx"]))) {
    if (isTestFile(file.split(/[\\/]/).at(-1))) continue;
    const text = readLf(file);
    for (const def of parseTypes(text)) defs.push({ ...def, file });
  }
  return defs;
}

/** Members of a definition including inherited ones; `open` when a base cannot be resolved. */
export function resolveMembers(def, defs, seen = new Set()) {
  const members = new Map(def.members);
  let open = def.open;
  seen.add(def.name);
  if (def.pick) {
    const source = defs.find((d) => d.name === def.pick.from);
    if (!source) open = true;
    else {
      const inner = resolveMembers(source, defs, seen);
      for (const key of def.pick.keys) if (inner.members.has(key)) members.set(key, inner.members.get(key));
      open ||= inner.open;
    }
  }
  for (const base of def.extends) {
    if (seen.has(base)) continue;
    const baseDef = defs.find((d) => d.name === base);
    if (!baseDef) {
      open = true;
      continue;
    }
    const inherited = resolveMembers(baseDef, defs, seen);
    for (const [k, v] of inherited.members) if (!members.has(k)) members.set(k, v);
    open ||= inherited.open;
  }
  return { members, open };
}

function splitRow(line) {
  const cells = [];
  let current = "";
  let tick = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "`") tick = !tick;
    if (c === "\\" && line[i + 1] === "|") {
      current += "|";
      i++;
    } else if (c === "|" && !tick) {
      cells.push(current.trim());
      current = "";
    } else current += c;
  }
  cells.push(current.trim());
  return cells.slice(1, line.trimEnd().endsWith("|") ? -1 : undefined);
}

/** Props tables of a page body: `{ line, marker, headers, rows: [{ name, cells }] }`. */
export function propsTables(body, { small = false } = {}) {
  const lines = proseOnly(body).split("\n");
  const raw = body.split("\n");
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("|") || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) continue;
    const headers = splitRow(lines[i]).map((h) => h.toLowerCase());
    let end = i + 2;
    while (end < lines.length && lines[end].trimStart().startsWith("|")) end++;
    if (NAME_HEADERS.has(headers[0])) {
      const rows = [];
      for (let r = i + 2; r < end; r++) {
        const name = /^`([A-Za-z_$][\w$]*)(?:\?|\(\))?`(?:\s*<NewBadge \/>)?$/.exec(raw[r].trim().startsWith("|") ? splitRow(raw[r])[0] : "")?.[1];
        if (name) rows.push({ name, cells: splitRow(raw[r]), line: r + 1 });
      }
      let m = i - 1;
      while (m >= 0 && lines[m].trim() === "" && raw[m].trim() === "") m--;
      const marker = /^\{\/\*\s*props:\s*([^*]+?)\s*\*\/\}$/.exec(raw[m]?.trim() ?? "")?.[1]?.split(/\s*,\s*/);
      if (rows.length >= 3 || (marker && rows.length >= 1) || (small && rows.length >= 1 && headers.some((h) => h === "type" || h === "default"))) tables.push({ line: i + 1, marker, headers, rows });
    }
    i = end - 1;
  }
  return tables;
}

const LITERAL = /^(-?\d[\d_]*(?:\.\d+)?|true|false|null|undefined|"[^"]*"|'[^']*')$/;
const normLiteral = (lit) => lit.replace(/^["']|["']$/g, "").replace(/_/g, "");

export function docDefault(cell) {
  const inner = /^`([^`]+)`$/.exec(cell ?? "")?.[1];
  return inner && LITERAL.test(inner) ? normLiteral(inner) : undefined;
}

export function sourceDefaults(name, dirTexts) {
  const found = new Set();
  const lit = String.raw`(-?\d[\d_]*(?:\.\d+)?|true|false|null|undefined|"[^"\n]*"|'[^'\n]*')`;
  const patterns = [new RegExp(String.raw`\b${name}\s*=\s*${lit}(?=\s*[,;})\n])`, "g"), new RegExp(String.raw`\b${name}\s*\?\?\s*${lit}(?=\s*[,;})\n])`, "g")];
  for (const text of dirTexts) for (const re of patterns) for (const m of text.matchAll(re)) found.add(normLiteral(m[1]));
  return found;
}

export function run({ root = process.cwd(), strict = false } = {}) {
  const defs = sourceIndex(root);
  const dirCache = new Map();
  const dirTexts = (file) => {
    const dir = dirname(file);
    if (!dirCache.has(dir)) dirCache.set(dir, walk(dir, [".ts", ".tsx"], ["node_modules"]).filter((f) => !isTestFile(f.split(/[\\/]/).at(-1)) && dirname(f) === dir).map(readLf));
    return dirCache.get(dir);
  };
  const failures = [];
  const warnings = [];
  const stats = { tables: 0, pinned: 0, guessed: 0, unmatched: 0, rows: 0, unverifiedDefaults: 0, suspect: 0, undocumented: 0 };
  for (const file of walk(join(root, "content/docs"), [".mdx"])) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    for (const table of propsTables(body, { small: strict })) {
      stats.tables++;
      const where = `${rel(root, file)}:${table.line + bodyOffset}`;
      const names = table.rows.map((r) => r.name);
      let candidates;
      if (table.marker) {
        candidates = table.marker.map((n) => defs.find((d) => d.name === n));
        const missing = table.marker.filter((n, i) => !candidates[i]);
        for (const n of missing) failures.push(`${where}: marker names ${n}, which no source type defines`);
        candidates = candidates.filter(Boolean);
        stats.pinned++;
      } else {
        let best = null;
        for (const def of defs) {
          const { members } = resolveMembers(def, defs);
          const score = names.filter((n) => members.has(n)).length / names.length;
          if (!best || score > best.score || (score === best.score && members.size < best.size)) best = { def, score, size: members.size };
        }
        if (best && best.score >= 0.6) {
          candidates = [best.def];
          stats.guessed++;
          (strict ? failures : warnings).push(`${where}: matched ${best.def.name} by name overlap; pin it with {/* props: ${best.def.name} */}`);
        } else {
          stats.unmatched++;
          (strict ? failures : warnings).push(`${where}: no source type matches this table (best overlap ${Math.round((best?.score ?? 0) * 100)}%)`);
          continue;
        }
      }
      if (candidates.length === 0) continue;
      const merged = new Map();
      let open = false;
      for (const def of candidates) {
        const resolved = resolveMembers(def, defs);
        for (const [k, v] of resolved.members) merged.set(k, { ...v, file: def.file });
        open ||= resolved.open;
      }
      const issues = [];
      const defaultColumn = table.headers.indexOf("default");
      for (const row of table.rows) {
        stats.rows++;
        const member = merged.get(row.name);
        if (!member) {
          if (!open) issues.push(`${rel(root, file)}:${row.line + bodyOffset}: \`${row.name}\` is not a member of ${candidates.map((d) => d.name).join(" / ")}`);
          continue;
        }
        if (defaultColumn < 0) continue;
        const cell = row.cells[defaultColumn] ?? "";
        const required = /^required$/i.test(cell.replace(/[*_`]/g, "").trim());
        if (required && member.optional) issues.push(`${rel(root, file)}:${row.line + bodyOffset}: \`${row.name}\` is marked required but the source member is optional`);
        const doc = docDefault(cell);
        if (doc === undefined) continue;
        if (!member.optional) issues.push(`${rel(root, file)}:${row.line + bodyOffset}: \`${row.name}\` has default ${cell} but the source member is required`);
        const found = sourceDefaults(row.name, dirTexts(member.file));
        if (found.size === 0) stats.unverifiedDefaults++;
        else if (!found.has(doc)) issues.push(`${rel(root, file)}:${row.line + bodyOffset}: \`${row.name}\` default ${cell} differs from source (${[...found].join(", ")})`);
      }
      if (table.marker || strict) failures.push(...issues);
      else if (issues.length) {
        stats.suspect += issues.length;
        warnings.push(...issues.map((i) => `(guessed type) ${i}`));
      }
      if (table.marker && !open) {
        const missing = [...merged.keys()].filter((k) => !names.includes(k));
        stats.undocumented += missing.length;
        if (missing.length) warnings.push(`${where}: members not in the table: ${missing.join(", ")}`);
      }
    }
  }
  return { name: "props", checked: stats.rows, stats, failures, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const result = run({ root: process.argv.includes("--root") ? arg("--root") : process.cwd(), strict: process.argv.includes("--strict") });
  const s = result.stats;
  for (const w of capped(result.warnings, 4)) console.warn(`warn  ${w}`);
  const summary = `${s.tables} tables (${s.pinned} pinned, ${s.guessed} guessed, ${s.unmatched} unmatched), ${s.rows} rows, ${s.suspect} suspect in guessed tables, ${s.unverifiedDefaults} defaults unverified`;
  if (result.failures.length) {
    console.error(`docs props: ${result.failures.length} mismatches; ${summary}\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs props: no mismatch; ${summary}`);
}
