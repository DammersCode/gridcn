import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

export const revalidate = false;

const BASE = 'https://gridcn.vercel.app';

const TAIL = [
  '',
  'Install via the shadcn CLI:',
  '',
  '```bash',
  `npx shadcn registry add "@gridcn=${BASE}/r/{name}.json"`,
  'npx shadcn add @gridcn/data-grid',
  '```',
  '',
  '## Registry',
  '',
  `- [Registry index](${BASE}/r/registry.json): All items (core, add-ons, demos) in the shadcn registry schema.`,
  `- [Core: data-grid](${BASE}/r/data-grid.json): The grid itself; add-ons include data-grid-history, data-grid-fill, data-grid-io, data-grid-lazy.`,
  '',
  '## Optional',
  '',
  `- [Project status](${BASE}/docs/project-status.md): Scope, decisions, open questions.`,
  '- [GitHub](https://github.com/DammersCode/gridcn): Source code, issues.',
  '',
].join('\n');

export async function GET() {
  // Link doc pages to their LLM-friendly .md versions (rewrites exist).
  const index = await llms(source).index();
  const withMdLinks = index
    .replace(/\]\((\/docs\/[^)]+)\)/g, `](${BASE}$1.md)`)
    .replace(/\]\((\/docs)\)/g, `](${BASE}/docs.md)`);
  return new Response(withMdLinks + TAIL);
}
