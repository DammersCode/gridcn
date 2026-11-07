import { source } from '@/lib/source';
import { rankSearchResults, withAliases, type SearchPageFacts } from '@/lib/docs-search';
import { createFromSource } from 'fumadocs-core/search/server';

const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
  async buildIndex(page) {
    return withAliases(
      { id: page.url, url: page.url, title: page.data.title, description: page.data.description, structuredData: page.data.structuredData },
      page.data.aliases,
    );
  },
});

const pageFacts: ReadonlyMap<string, SearchPageFacts> = new Map(
  source.getPages().map((page) => [page.url, { title: page.data.title, aliases: page.data.aliases }]),
);

// The engine stops at its item limit, so ask for more items than the dialog shows before the reorder.
const engineLimit = 200;
const resultLimit = 60;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.slice(0, 200);
  if (!query) return Response.json([]);
  const results = await server.search(query, { limit: engineLimit });
  return Response.json(rankSearchResults(query, results, pageFacts).slice(0, resultLimit));
}
