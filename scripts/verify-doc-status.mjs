// Fails when a docs page changed in substance since the last release (tag v*, else origin/main) has no `status`, or has one without a change.
// A stale `status` that shipped with the latest release only warns until the first commit after the tag.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const tryGit = (...args) => {
  try {
    return git(...args).trim();
  } catch {
    return null;
  }
};
const BASE = tryGit("describe", "--tags", "--abbrev=0", "--match", "v*") ?? "origin/main";

if (tryGit("rev-parse", "--verify", BASE) === null) {
  console.log(`verify-doc-status: ${BASE} not found locally, skipped.`);
  process.exit(0);
}
const PREV = BASE.startsWith("v") ? tryGit("describe", "--tags", "--abbrev=0", "--match", "v*", `${BASE}^`) : null;

const statusOf = (text) => /^status:\s*(\S+)\s*$/m.exec(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "")?.[1];
// Wording-only edits (punctuation, whitespace, link targets, status line) are not a content change.
const essence = (text) =>
  text
    .replace(/^status:.*$/m, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<NewBadge\s*\/>/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const showAt = (ref, file) => tryGit("show", `${ref}:${file}`);
const withoutStatus = (text) => text.replace(/^status:.*$/m, "");
const shippedWithBase = (file, atBase, status) => {
  if (!PREV || statusOf(atBase) !== status) return false;
  const atPrev = showAt(PREV, file);
  if (atPrev === null || essence(atPrev) !== essence(atBase)) return true;
  return status === "none" && withoutStatus(atPrev) !== withoutStatus(atBase);
};

const files = git("ls-files", "content/docs").split("\n").filter((f) => f.endsWith(".mdx"));
const problems = [];
const stale = [];
for (const file of files) {
  const now = fs.readFileSync(file, "utf8");
  const before = showAt(BASE, file);
  const status = statusOf(now);
  if (before === null) {
    if (status !== "new") problems.push(`${file}: added since ${BASE}, set \`status: new\``);
  } else if (essence(now) !== essence(before)) {
    if (!status) problems.push(`${file}: changed since ${BASE}, set \`status: updated\``);
  } else if (status) {
    if (shippedWithBase(file, before, status)) stale.push(`${file}: shipped in ${BASE}, remove \`status: ${status}\``);
    else problems.push(`${file}: unchanged since ${BASE}, remove \`status: ${status}\``);
  }
}

if (stale.length) {
  console.warn(`verify-doc-status: ${stale.length} marker(s) shipped in ${BASE}; remove them in the first commit after the tag`);
  console.warn(stale.slice(0, 5).join("\n") + (stale.length > 5 ? `\n… and ${stale.length - 5} more` : ""));
}
if (problems.length) {
  console.error(`verify-doc-status failed:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-doc-status: ok");
