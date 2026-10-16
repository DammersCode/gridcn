import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';
import { LLMS_TASKS, SKILL_NAMES, headingAnchors } from '@/lib/llms-tasks';

export const revalidate = false;

const BASE = 'https://gridcn.vercel.app';

const SKILLS = [
  '',
  '## Skills',
  '',
  ...SKILL_NAMES.map((name) => `- [${name}](${BASE}/skills/${name}/SKILL.md): Agent skill, raw SKILL.md.`),
  '',
].join('\n');

const TAIL = [
  '',
  'Install via the shadcn CLI:',
  '',
  '```bash',
  'npx shadcn add @gridcn/data-grid',
  '```',
  '',
  'Install the agent skills (performance audit, custom cell types, data sources, add-ons, upgrades):',
  '',
  '```bash',
  'npx skills add DammersCode/gridcn',
  '```',
  '',
  '## Registry',
  '',
  `- [Registry index](${BASE}/r/registry.json): All items (core, add-ons, demos) in the shadcn registry schema.`,
  `- [Core: data-grid](${BASE}/r/data-grid.json): The grid itself; add-ons include data-grid-history, data-grid-fill, data-grid-io, data-grid-lazy.`,
  '',
  '## Optional',
  '',
  `- [Add-ons overview](${BASE}/docs/addons.md): One page per add-on block.`,
  `- [Project status](${BASE}/docs/project-status.md): Scope, decisions, open questions.`,
  `- [License](${BASE}/docs/license.md): Apache License 2.0. Legal text: [LICENSE](https://github.com/DammersCode/gridcn/blob/main/LICENSE).`,
  '- [GitHub](https://github.com/DammersCode/gridcn): Source code, issues.',
  '',
].join('\n');

async function taskIndex() {
  const lines = await Promise.all(
    LLMS_TASKS.map(async (task) => {
      const page = source.getPage(task.slug);
      if (!page) throw new Error(`llms.txt task "${task.intent}": page /docs/${task.slug.join('/')} does not exist`);
      if (task.anchor && !headingAnchors(await page.data.getText('processed')).has(task.anchor)) {
        throw new Error(`llms.txt task "${task.intent}": #${task.anchor} is not a heading of ${page.url}`);
      }
      return `- ${task.intent}: [${task.label}](${BASE}${page.url}.md${task.anchor ? `#${task.anchor}` : ''})`;
    }),
  );
  return ['## Task index', '', ...lines, ''].join('\n');
}

export async function GET() {
  // Link doc pages to their LLM-friendly .md versions (rewrites exist).
  const index = await llms(source).index();
  const withMdLinks = index
    .replace(/\]\((\/docs\/[^)]+)\)/g, `](${BASE}$1.md)`)
    .replace(/\]\((\/docs)\)/g, `](${BASE}/docs.md)`);
  const [title, ...rest] = withMdLinks.split('\n');
  const bodyStart = rest.findIndex((line) => line.startsWith('- '));
  const head = [title, ...rest.slice(0, bodyStart)].join('\n');
  const body = rest.slice(bodyStart).join('\n');
  return new Response([head, await taskIndex(), '## Docs', '', body].join('\n') + SKILLS + TAIL);
}
