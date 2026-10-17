#!/usr/bin/env node
// Fails when the agent-markdown converter leaves an MDX component in any docs page.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findRawComponents, toAgentMarkdown } from "../lib/llms-markdown.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docsRoot = join(root, "content", "docs");
const resolvers = {
  typeTable: async () => [{ name: "stub", type: "string", required: false, description: "" }],
  keymap: () => "stub",
};

const violations = [];
for (const entry of readdirSync(docsRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".mdx")) continue;
  const file = join(entry.parentPath, entry.name);
  const converted = await toAgentMarkdown(readFileSync(file, "utf8"), resolvers);
  const left = [...new Set(findRawComponents(converted))];
  if (left.length > 0) violations.push(`${relative(root, file)}: <${left.join(">, <")}>`);
}

if (violations.length > 0) {
  console.error(`Raw MDX components remain after conversion:\n${violations.map((v) => `  ${v}`).join("\n")}`);
  process.exit(1);
}
console.log("llms markdown: no raw MDX components remain");
