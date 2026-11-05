// Mechanical checks for the docs prose rules of AGENTS.md and the simple-english skill.
// Hard rules fail; heuristic rules (passive voice, -ing clauses, phantom contrast) fail only past a per-page limit.
// A paragraph preceded by {/* lint-ok: reason */} is skipped.
// Usage: node scripts/verify-docs-prose.mjs [--root <dir>] [--files a.mdx,b.mdx] [--max-passive 3]
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { capped, codeBlocks, proseOnly, readLf, rel, splitFrontmatter, walk } from "./docs-verify-lib.mjs";

const MAX_SENTENCE_WORDS = 25;
const MAX_PARAGRAPH_WORDS = 110;
const MAX_PARAGRAPH_SENTENCES = 7;

const HARD = [
  ["banned-modal", /\b(should|would|may|might|could)\b/i, "use can, will, or must"],
  ["contraction", /\b(?:\w+n't|(?:it|that|there|what|let|here|he|she|you|we|they|I)['’](?:s|re|ll|ve|d|m))\b/i, "write the words in full"],
  ["semicolon", /;/, "split the sentence"],
  ["slop", /\b(simply|just|easily|easy|powerful|seamless(?:ly)?|leverage[sd]?|robust|delve|basically|in order to|it['’]?s worth noting|note that|blazing|effortless(?:ly)?|out of the box|under the hood)\b/i, "cut the filler"],
  ["timeless", /\b(now|currently|latest|soon|eventually|recently|no longer|as of this writing|(?:new|newly) (?:in|since|feature|option|prop))\b/i, "docs state the current behavior; CHANGELOG.md holds what is new"],
  ["toolchain", /\b(IntelliSense|autocomplete|type-?safe(?:ty)?|type error|compiler (?:error|rejects|warns))\b/i, "the reader's editor shows this"],
];
const SOFT = [
  ["passive", /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w{3,}ed|built|made|written|given|shown|run|done|set|sent|kept|held|read|seen|known|taken|chosen|drawn|found|left|lost|put)\b/i, "write it in the active voice"],
  ["ing-clause", /,\s+\w+ing\b/, "split the clause"],
  ["phantom-contrast", /\b(?:not an? (?:array|object|string|function)|instead of|rather than)\b/i, "state the property positively"],
  ["late-condition", /[a-z,]\s+(?:if|when|unless)\s/, "put the condition first"],
];
const SKIP_LINE = /^\s*(?:#{1,6}\s|\||<\/?[A-Za-z]|\{\/\*|import\s|export\s|---|>)/;
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

function paragraphs(body) {
  const lines = proseOnly(body).split("\n");
  const out = [];
  let current = null;
  const close = () => {
    if (current) out.push(current);
    current = null;
  };
  lines.forEach((line, index) => {
    if (line.trim() === "" || SKIP_LINE.test(line)) {
      close();
      return;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      close();
      current = { line: index + 1, text: item[1], item: true };
      return;
    }
    if (current) current.text += ` ${line.trim()}`;
    else current = { line: index + 1, text: line.trim() };
  });
  close();
  return out;
}

const clean = (text) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b(e)\.g\.|\b(i)\.e\./gi, (m) => m.replace(/\./g, ""))
    .replace(/\bvs\./g, "vs");

const sentencesOf = (text) =>
  clean(text)
    .split(/(?<=[.!?])["')\]]*\s+(?=[A-Z0-9`<(x])/)
    .map((s) => s.trim())
    .filter(Boolean);
const wordCount = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function lintPage(body) {
  const hits = [];
  const lines = body.split("\n");
  for (const p of paragraphs(body)) {
    if (/lint-ok/.test(lines[p.line - 2] ?? "")) continue;
    const sentences = sentencesOf(p.text);
    const words = wordCount(clean(p.text));
    if (!p.item && words > MAX_PARAGRAPH_WORDS) hits.push({ rule: "long-paragraph", line: p.line, soft: false, note: `${words} words, limit ${MAX_PARAGRAPH_WORDS}` });
    if (!p.item && sentences.length > MAX_PARAGRAPH_SENTENCES) hits.push({ rule: "long-paragraph", line: p.line, soft: false, note: `${sentences.length} sentences, limit ${MAX_PARAGRAPH_SENTENCES}` });
    for (const sentence of sentences) {
      const count = wordCount(sentence);
      if (count > MAX_SENTENCE_WORDS) hits.push({ rule: "long-sentence", line: p.line, soft: false, note: `${count} words: ${sentence.slice(0, 50)}` });
      for (const [rule, re, note] of HARD) {
        const m = re.exec(sentence);
        if (m) hits.push({ rule, line: p.line, soft: false, note: `"${m[0]}": ${note}` });
      }
      for (const [rule, re, note] of SOFT) {
        const text = rule === "late-condition" ? sentence.replace(/^(?:if|when|unless)\b/i, "") : sentence;
        const m = re.exec(text);
        if (m) hits.push({ rule, line: p.line, soft: true, note: `"${m[0].trim()}": ${note}` });
      }
    }
  }
  for (const block of codeBlocks(body)) {
    block.code.split("\n").forEach((line, i) => {
      if (/(^|[\s({[,])\.\.\.(?=[\s)}\],;]|$)/.test(line)) hits.push({ rule: "omission-dots", line: block.line + i, soft: false, note: "mark an omission with a comment, not ..." });
    });
    const before = lines.slice(0, block.line - 2).reverse().find((l) => l.trim() !== "");
    if (before && !/^\s*(?:[<#|{>`*-]|\d+\.|import)/.test(before) && !/:\s*$/.test(before)) hits.push({ rule: "intro-colon", line: block.line - 1, soft: false, note: "end the sentence before a code sample with a colon" });
  }
  const fencedLine = new Set();
  for (const block of codeBlocks(body)) for (let l = block.line - 1; l <= block.endLine; l++) fencedLine.add(l);
  const numberedAt = lines.map((line, i) => (/^\s*\d+\.\s/.test(line) && !fencedLine.has(i + 1) ? i : -1)).filter((i) => i >= 0);
  const headingAt = lines.map((line, i) => (/^#{1,6}\s/.test(line) ? i : -1)).filter((i) => i >= 0);
  const sectionOf = (i) => headingAt.filter((h) => h < i).length;
  for (const i of numberedAt) {
    if (!numberedAt.some((j) => j !== i && sectionOf(j) === sectionOf(i))) hits.push({ rule: "one-item-list", line: i + 1, soft: false, note: "write a one-item list as prose" });
  }
  return hits;
}

export function run({ root = process.cwd(), files, maxPassive = 3 } = {}) {
  const pageFiles = files ? files.map((f) => join(root, f)) : walk(join(root, "content/docs"), [".mdx"]);
  const failures = [];
  const warnings = [];
  const counts = {};
  for (const file of pageFiles) {
    const { body, bodyOffset } = splitFrontmatter(readLf(file));
    const hits = lintPage(body);
    const soft = hits.filter((h) => h.soft);
    for (const h of hits) counts[h.rule] = (counts[h.rule] ?? 0) + 1;
    for (const h of hits.filter((x) => !x.soft)) failures.push(`${rel(root, file)}:${h.line + bodyOffset}: ${h.rule}: ${h.note}`);
    const passive = soft.filter((h) => h.rule === "passive");
    if (passive.length > maxPassive) failures.push(`${rel(root, file)}: passive voice in ${passive.length} sentences, limit ${maxPassive}`);
    for (const h of soft) warnings.push(`${rel(root, file)}:${h.line + bodyOffset}: ${h.rule}: ${h.note}`);
  }
  return { name: "prose", checked: pageFiles.length, failures, warnings, stats: { counts } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
  const result = run({
    root: process.argv.includes("--root") ? arg("--root") : process.cwd(),
    files: process.argv.includes("--files") ? arg("--files").split(",") : undefined,
    maxPassive: process.argv.includes("--max-passive") ? Number(arg("--max-passive")) : 3,
  });
  const counts = Object.entries(result.stats.counts).map(([k, v]) => `${k} ${v}`).join(", ");
  if (result.failures.length) {
    console.error(`docs prose: ${result.failures.length} failures in ${result.checked} pages (hits: ${counts})\n${capped(result.failures).map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`docs prose: ${result.checked} pages clean (hits: ${counts || "none"})`);
}
