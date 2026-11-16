// Fails on block file names, hook files and folder shapes that break CONTRIBUTING "Block folder rules". Fix: follow the message.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BLOCKS = "registry/default/blocks/";
const KEBAB = "[a-z0-9]+(?:-[a-z0-9]+)*";
const SUFFIX = "(?:test|browser\.test|type-test|test-helper|perf\.test|property\.test|bench)";
const PLAIN_NAME = new RegExp(`^${KEBAB}\.tsx?$`);
const TOPIC_NAME = new RegExp(`^${KEBAB}(?:\.${KEBAB})*\.${SUFFIX}\.tsx?$`);
const HOOK_EXPORT = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const)\s+use[A-Z]|export\s*\{[^}]*\buse[A-Z]/;
const MAX_DEPTH = 2;

/** Problems for `files` (`{ path, text }`, paths relative to the repo root with forward slashes). */
export function namingProblems(files) {
  const problems = [];
  const folderFiles = new Map();
  for (const { path, text } of files) {
    if (!path.startsWith(BLOCKS)) continue;
    const name = basename(path);
    const folder = dirname(path);
    folderFiles.set(folder, (folderFiles.get(folder) ?? 0) + 1);
    if (!/\.tsx?$/.test(name)) continue;
    if (!PLAIN_NAME.test(name) && !TOPIC_NAME.test(name)) {
      problems.push(`${path} — name a file in kebab-case with an optional topic infix and a suffix from .test, .browser.test, .type-test, .test-helper, .perf.test, .property.test, .bench`);
    }
    if (PLAIN_NAME.test(name) && name.startsWith("use-") && !HOOK_EXPORT.test(text)) {
      problems.push(`${path} — a use-* file exports a use* hook; rename the file or export the hook`);
    }
  }
  for (const [folder, count] of folderFiles) {
    const inBlock = folder.slice(BLOCKS.length).split("/").filter(Boolean);
    if (inBlock.length <= 1) continue;
    if (inBlock.length > MAX_DEPTH + 1) problems.push(`${folder} — folders nest at most ${MAX_DEPTH} levels inside a block`);
    if (count < 2) problems.push(`${folder} — a folder holds 2 or more files; inline the single file`);
  }
  return problems;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function main() {
  const files = [...walk(join(root, "registry", "default", "blocks"))].map((file) => ({
    path: relative(root, file).replaceAll("\\", "/"),
    text: /\.tsx?$/.test(file) ? readFileSync(file, "utf8") : "",
  }));
  const problems = namingProblems(files);
  if (problems.length > 0) {
    console.error(`verify-source-naming: ${problems.length} problem(s)\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("verify-source-naming: ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
