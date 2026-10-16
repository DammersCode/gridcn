// Turns the MDX components in processed docs markdown into plain markdown for agents.
// Dependency-free so scripts/verify-llms-markdown.mjs can import it under Node type stripping.

export type TypeTableRow = { name: string; type: string; required: boolean; defaultValue?: string; description: string };

export type LlmsMarkdownResolvers = {
  typeTable: (path: string, name: string) => Promise<TypeTableRow[]>;
  keymap: () => string;
};

/** Components the converter replaces. The verify script fails when one survives in the output. */
export const CONVERTED_COMPONENTS = [
  "AutoTypeTable",
  "InstallCommand",
  "ComponentPreview",
  "SkillInstall",
  "NewBadge",
  "KeymapTable",
  "ManualInstall",
  "Callout",
  "Tabs",
  "Tab",
  "Cards",
  "Card",
  "Steps",
  "Step",
] as const;

const CALLOUT_LABELS: Record<string, string> = { warn: "Warning", warning: "Warning", error: "Error", idea: "Tip", info: "Note" };
const RUNNER_LINES = ["npx shadcn@latest", "pnpm dlx shadcn@latest", "yarn dlx shadcn@latest"];
const FENCE = /^\s*(```|~~~)/;
const LEAF = /^(\s*)<(AutoTypeTable|InstallCommand|ComponentPreview|KeymapTable|Card|ManualInstall)\b/;
const OPEN = /^(\s*)<(Callout|Tabs|Tab|Cards|Steps|Step)\b/;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Index just past the `>` that ends the tag starting at `start`, or -1 while the tag is incomplete. */
function tagEnd(text: string, start: number): number {
  let quote = "";
  let braces = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === ">" && braces === 0) return i + 1;
  }
  return -1;
}

type Props = Partial<Record<"path" | "name" | "item" | "items" | "command" | "title" | "href" | "description" | "type" | "value", string>>;

function parseProps(tag: string): Props {
  const props: Record<string, string> = {};
  for (const match of tag.matchAll(/\s([A-Za-z]+)=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s+[A-Za-z]+=|\s*\/?>))/g)) {
    props[match[1]!] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return props;
}

function installBlock(addArgs: string): string {
  return ["```bash", ...RUNNER_LINES.map((runner) => `${runner} ${addArgs}`), "```"].join("\n");
}

function installCommand(tag: string): string {
  const props = parseProps(tag);
  if (props.command) return ["```bash", `npx ${props.command}`, "```"].join("\n");
  if (props.item) return installBlock(`add @gridcn/${props.item}`);
  const items = [...(props.items ?? "").matchAll(/value:\s*["']([\w-]+)["']/g)].map((m) => `@gridcn/${m[1]}`);
  return ["```bash", `npx shadcn@latest add ${items.join(" ")}`, "```"].join("\n");
}

const cell = (value: string) => value.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();

function typeTableMarkdown(rows: TypeTableRow[]): string {
  const lines = ["| Prop | Type | Default | Required | Description |", "| --- | --- | --- | --- | --- |"];
  for (const row of rows) {
    const fields = [`\`${row.name}\``, `\`${cell(row.type)}\``, row.defaultValue ? `\`${cell(row.defaultValue)}\`` : "", row.required ? "yes" : "", cell(row.description)];
    lines.push(`| ${fields.join(" | ")} |`);
  }
  return lines.join("\n");
}

async function leaf(name: string, tag: string, resolvers: LlmsMarkdownResolvers): Promise<string> {
  const props = parseProps(tag);
  switch (name) {
    case "AutoTypeTable": {
      if (!props.path || !props.name) throw new Error(`AutoTypeTable needs path and name: ${tag}`);
      return typeTableMarkdown(await resolvers.typeTable(props.path, props.name));
    }
    case "InstallCommand":
      return installCommand(tag);
    case "ComponentPreview":
      return `Live demo \`${props.name}\`. \`npx shadcn@latest add @gridcn/${props.name}\` installs its source.`;
    case "KeymapTable":
      return resolvers.keymap();
    case "Card":
      return `- [${props.title}](${props.href})${props.description ? `: ${props.description}` : ""}`;
    default:
      return "";
  }
}

function dedent(lines: string[]): string[] {
  const indents = lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(cut, /^\s*/.exec(line)![0].length)));
}

function inlineSkillInstall(line: string): string {
  return line.replace(/\s*<NewBadge\s*\/>/g, " (new)").replace(/<SkillInstall\s+skill="([^"]+)"\s*\/>/g, (_, skill: string) => `\`npx skills add DammersCode/gridcn@${skill}\``);
}

function calloutMarkdown(props: Props, body: string[]): string[] {
  const label = CALLOUT_LABELS[props.type ?? ""] ?? "Note";
  const head = `> **${props.title ? `${label}: ${props.title}` : label}**`;
  return [head, ">", ...body.map((line) => (line.trim() ? `> ${line}` : ">"))];
}

async function render(lines: string[], resolvers: LlmsMarkdownResolvers): Promise<string[]> {
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || FENCE.test(line)) {
      out.push(line);
      continue;
    }

    const leafMatch = LEAF.exec(line);
    if (leafMatch) {
      let text = line.trimStart();
      while (tagEnd(text, 0) === -1 && i + 1 < lines.length) text += `\n${lines[++i]}`;
      const markdown = await leaf(leafMatch[2]!, text, resolvers);
      out.push(...markdown.split("\n").map((row) => (row ? leafMatch[1] + row : row)));
      continue;
    }

    const openMatch = OPEN.exec(line);
    if (!openMatch) {
      out.push(inlineSkillInstall(line));
      continue;
    }

    const [, indent, name] = openMatch as unknown as [string, string, string];
    const openText = line.trimStart();
    const end = tagEnd(openText, 0);
    const props = parseProps(openText.slice(0, Math.max(end, 0)));
    const sameLineClose = new RegExp(`</${name}>\\s*$`).exec(openText);
    if (sameLineClose) {
      const inner = openText.slice(end, sameLineClose.index);
      const body = await render(dedent([inner]), resolvers);
      out.push(...(name === "Callout" ? calloutMarkdown(props, body) : body).map((row) => indent + row));
      continue;
    }

    const bodyLines: string[] = [];
    let depth = 1;
    let bodyFence = false;
    for (i++; i < lines.length; i++) {
      const current = lines[i]!;
      if (FENCE.test(current)) bodyFence = !bodyFence;
      if (!bodyFence && !FENCE.test(current)) {
        if (new RegExp(`^\\s*<${name}\\b(?![^>]*/>)[^>]*>\\s*$`).test(current)) depth++;
        if (new RegExp(`^\\s*</${name}>\\s*$`).test(current) && --depth === 0) break;
      }
      bodyLines.push(current);
    }
    const body = await render(dedent(bodyLines), resolvers);
    const rows = name === "Callout" ? calloutMarkdown(props, body) : name === "Tab" ? [`**${props.value ?? ""}**`, "", ...body] : body;
    out.push(...rows.map((row) => (row ? indent + row : row)), "");
  }
  return out;
}

/** Replaces every MDX component in `markdown` with plain markdown. Code fences pass through untouched. */
export async function toAgentMarkdown(markdown: string, resolvers: LlmsMarkdownResolvers): Promise<string> {
  const lines = await render(markdown.split("\n"), resolvers);
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

/** Names of converted components still present as JSX outside code fences and inline code. */
export function findRawComponents(markdown: string): string[] {
  const found: string[] = [];
  let inFence = false;
  const tag = new RegExp(`</?(${CONVERTED_COMPONENTS.join("|")})\\b`);
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = tag.exec(line.replace(/`[^`]*`/g, ""));
    if (match) found.push(match[1]!);
  }
  return found;
}
