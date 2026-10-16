// Fails when a docs page changed in substance since origin/main has no `status`, or has one without a change.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "origin/main";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

try {
  git("rev-parse", "--verify", BASE);
} catch {
  console.log(`verify-doc-status: ${BASE} not found locally, skipped.`);
  process.exit(0);
}

const statusOf = (text) => /^status:\s*(\S+)\s*$/m.exec(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "")?.[1];
// Wording-only edits (punctuation, whitespace, link targets, status line) are not a content change.
const essence = (text) =>
  text
    .replace(/^status:.*$/m, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<NewBadge\s*\/>/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

const files = git("ls-files", "content/docs").split("\n").filter((f) => f.endsWith(".mdx"));
const problems = [];
for (const file of files) {
  const now = fs.readFileSync(file, "utf8");
  let before = null;
  try {
    before = git("show", `${BASE}:${file}`);
  } catch {}
  const status = statusOf(now);
  if (before === null) {
    if (status !== "new") problems.push(`${file}: added since ${BASE}, set \`status: new\``);
  } else if (essence(now) !== essence(before)) {
    if (!status) problems.push(`${file}: changed since ${BASE}, set \`status: updated\``);
  } else if (status) {
    problems.push(`${file}: unchanged since ${BASE}, remove \`status: ${status}\``);
  }
}

if (problems.length) {
  console.error(`verify-doc-status failed:\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("verify-doc-status: ok");
