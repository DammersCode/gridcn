#!/usr/bin/env node
// Copies skills/ to public/skills/ so each skill is served at /skills/<name>/SKILL.md. `--check` fails on drift.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "skills");
const target = join(root, "public", "skills");

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll("\\", "/"))
    .sort();
}

if (process.argv.includes("--check")) {
  const expected = listFiles(source);
  const actual = existsSync(target) ? listFiles(target) : [];
  const drifted = expected.filter((file) => !actual.includes(file) || readFileSync(join(source, file), "utf8") !== readFileSync(join(target, file), "utf8"));
  const stale = actual.filter((file) => !expected.includes(file));
  if (drifted.length + stale.length > 0) {
    console.error(`public/skills is out of date (${[...drifted, ...stale].join(", ")}). Run: node scripts/sync-skills.mjs`);
    process.exit(1);
  }
  console.log("public/skills matches skills/");
} else {
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`synced skills/ -> public/skills/ (${listFiles(source).length} files)`);
}
