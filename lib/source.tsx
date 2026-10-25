import { docs } from 'collections/server';
import changes from '../content/docs-changes.json';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { toAgentMarkdown, type LlmsMarkdownResolvers } from './llms-markdown';
import { groupDefaultKeymap } from './default-keymap-groups';
import { getTypeGenerator } from './type-generator';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [
    lucideIconsPlugin(),
    {
      name: 'gridcn:page-status',
      transformPageTree: {
        file(node, filePath) {
          const key = filePath?.replace(/\\/g, '/').replace(/^(\.\/)?(content\/docs\/)?/, '');
          const status = key ? (changes.pages as Record<string, string>)[key] : undefined;
          if (status) (node as { status?: string }).status = status;
          return node;
        },
      },
    },
  ],
});

export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `${docsImageRoute}/${segments.join('/')}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join('/')}`,
  };
}

const resolvers: LlmsMarkdownResolvers = {
  async typeTable(path, name) {
    const docs = await getTypeGenerator().generateTypeTable({ path, name });
    return docs.flatMap((doc) =>
      doc.entries.map((entry) => ({
        name: entry.name,
        type: entry.required ? entry.type : entry.type.replace(/ \| undefined$/, ''),
        required: entry.required,
        defaultValue: entry.tags.find((tag) => tag.name === 'default')?.text,
        description: entry.description,
      })),
    );
  },
  keymap() {
    return groupDefaultKeymap()
      .map(({ category, rows }) => {
        const bullets = rows.map((row) => `- ${row.label}: ${row.bindings.map((binding) => `\`${binding}\``).join(', ')}`);
        return [`**${category}**`, '', ...bullets].join('\n');
      })
      .join('\n\n');
  },
};

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await toAgentMarkdown(await page.data.getText('processed'), resolvers);

  return `# ${page.data.title} (${page.url})

${processed}`;
}
