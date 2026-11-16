import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import { rehypeCodeDefaultOptions } from 'fumadocs-core/mdx-plugins';
import { CODE_THEMES } from './lib/code-themes';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
const pageTypes = ['landing', 'feature', 'concept', 'task', 'step', 'reference', 'example', 'cheatsheet'] as const;

// Docs frontmatter beyond the Fumadocs defaults; scripts/verify-docs-structure.mjs checks the values.
const docsPageSchema = pageSchema.extend({
  type: z.enum(pageTypes).optional(),
  aliases: z.array(z.string()).optional(),
  finder: z.string().optional(),
  kind: z.enum(['core', 'add-on']).optional(),
  modes: z.array(z.enum(['client', 'server'])).optional(),
  stability: z.string().optional(),
  since: z.string().optional(),
  demos: z.enum(['compare', 'none']).optional(),
});

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: docsPageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: CODE_THEMES,
      transformers: [
        ...(rehypeCodeDefaultOptions.transformers ?? []),
        {
          name: 'gridcn:pre-language',
          pre(node) {
            node.properties['data-language'] = this.options.lang;
          },
        },
      ],
    },
  },
});
