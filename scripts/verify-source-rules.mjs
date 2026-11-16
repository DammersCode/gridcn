// Fails on source patterns that shipped bugs before. Fix: follow the message.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Files that may list every member of a selection channel, with the count of `.toArray()` calls and the reason. */
export const CHANNEL_LIST_ALLOWLIST = new Map([
  ["registry/default/blocks/data-grid/selection/compact-selection.ts", { count: 1, reason: "adopt rebuilds a structural channel that has only toArray" }],
  ["registry/default/blocks/data-grid/selection/selected-view-rows.ts", { count: 2, reason: "getSelectedViewRows returns every selected view row as a list" }],
  ["registry/default/blocks/data-grid/body.tsx", { count: 1, reason: "reorderRows takes the dragged rows as a list, and its move plan is linear in the row count" }],
  ["registry/default/blocks/data-grid/clipboard/use-grid-clipboard.ts", { count: 1, reason: "the column channel holds at most one member per visible column" }],
]);

const CHANNEL_SPREAD = /(?:\.\.\.\s*|Array\.from\(\s*)[\w.]*selection\.(?:rows|columns)\b(?!\.runs\(\))/;
const TO_ARRAY = /\.toArray\(\)/g;

/**
 * Problems for `.toArray()` calls and iterator spreads of selection channels in `files`
 * (`{ path, text }`, paths relative to the repo root with forward slashes).
 */
export function checkChannelMaterialization(files, allowlist = CHANNEL_LIST_ALLOWLIST) {
  const problems = [];
  const seen = new Set();
  for (const { path, text } of files) {
    const lines = text.split(/\r?\n/);
    const toArrayLines = [];
    lines.forEach((line, i) => {
      if (CHANNEL_SPREAD.test(line)) problems.push(`${path}:${i + 1} — walk the channel's runs() instead of spreading it into a list`);
      const calls = line.match(TO_ARRAY)?.length ?? 0;
      for (let call = 0; call < calls; call++) toArrayLines.push(i + 1);
    });
    const allowed = allowlist.get(path);
    if (allowed) seen.add(path);
    if (!allowed) {
      for (const line of toArrayLines) problems.push(`${path}:${line} — walk the channel's runs() instead of toArray(); a list of every checked row costs O(rows)`);
    } else if (toArrayLines.length !== allowed.count) {
      problems.push(`${path} — has ${toArrayLines.length} toArray() call(s) but the allowlist expects ${allowed.count}; walk runs() or update CHANNEL_LIST_ALLOWLIST with a reason`);
    }
  }
  for (const path of allowlist.keys()) {
    if (!seen.has(path)) problems.push(`${path} — listed in CHANNEL_LIST_ALLOWLIST but not found; remove the entry`);
  }
  return problems;
}

function* walk(dir, pattern) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, pattern);
    else if (pattern.test(entry.name) && !/\.(?:test|type-test)\.tsx?$/.test(entry.name)) yield full;
  }
}

function main() {
  const problems = [];
  const scan = (dirs, filePattern, linePattern, message, skip = () => false) => {
    for (const dir of dirs) {
      for (const file of walk(join(root, dir), filePattern)) {
        if (skip(file)) continue;
        readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
          if (linePattern.test(line)) problems.push(`${relative(root, file)}:${i + 1} — ${message}`);
        });
      }
    }
  };

  scan(["registry/default/blocks"], /\.tsx?$/, /process\.env\.NODE_ENV/, "read the environment through isDev", (file) => basename(file) === "is-dev.ts");
  scan(["registry/default/blocks"], /\.tsx?$/, /\.isComposing\b/, "read IME state through isComposingKey, which also covers the Safari keyCode 229 confirm key", (file) => basename(file) === "is-composing-key.ts");
  scan(["registry/default/blocks"], /\.tsx?$/, /Math\.(?:min|max)\(\.\.\./, "reduce or loop instead of spreading into Math.min or Math.max; a large array throws RangeError");
  scan(["registry/default/blocks"], /\.tsx$/, /\[-?\d+(?:\.\d+)?px\]/, "use a Tailwind scale value or a CSS variable with a fallback; a preset cannot change a fixed px size");
  scan(["registry/default/examples", "components", "app"], /\.tsx?$/, /toLocale(?:Date|Time)?String\(\)|Intl\.(?:NumberFormat|DateTimeFormat)\((?:undefined)?\)/, "pin the locale so server and client render the same text");
  scan(["registry/default/examples"], /\.tsx?$/, /onDataChange=\{\(\s*(\w+)[^)]*\)\s*=>\s*\w+\(\[\.\.\.\1\]\)/, "store the array onDataChange hands over as given; a copy defeats the store's echo check");

  const blockFiles = [...walk(join(root, "registry", "default", "blocks"), /\.tsx?$/)].map((file) => ({
    path: relative(root, file).replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));
  problems.push(...checkChannelMaterialization(blockFiles));

  const examplesMap = readFileSync(join(root, "components", "registry-examples.tsx"), "utf8");
  for (const file of walk(join(root, "registry", "default", "examples"), /-demo\.tsx$/)) {
    const name = basename(file, ".tsx");
    if (!examplesMap.includes(`"${name}":`)) problems.push(`components/registry-examples.tsx — register ${name} in the examples map`);
  }

  if (problems.length > 0) {
    console.error(`verify-source-rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log("verify-source-rules: ok");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
