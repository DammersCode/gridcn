import type { AdvancedIndex } from 'fumadocs-core/search/server';
import type { SortedResult } from 'fumadocs-core/search';

export type SearchPageFacts = { title: string; aliases?: readonly string[] };

/** Pages that list every term or message: they match most queries, so they rank after the owner pages. */
export const demotedSearchUrls: ReadonlySet<string> = new Set(['/docs/terms-help/terms', '/docs/cheatsheets-messages/messages']);

/** Adds the page's frontmatter aliases to its index as one text block. */
export function withAliases(index: AdvancedIndex, aliases: readonly string[] | undefined): AdvancedIndex {
  if (!aliases?.length) return index;
  const { structuredData } = index;
  return {
    ...index,
    structuredData: { ...structuredData, contents: [...structuredData.contents, { heading: undefined, content: aliases.join(', ') }] },
  };
}

// Folds a plural "-s" so "rows" matches "row"; short words keep their letters.
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));

function phraseScore(query: readonly string[], phrase: string): number {
  const target = words(phrase);
  if (target.length === 0) return 0;
  if (query.length === target.length && query.every((word, i) => word === target[i])) return 3;
  if (query.every((word) => target.includes(word))) return 2;
  if (target.every((word) => query.includes(word))) return 1;
  return 0;
}

function pageScore(query: readonly string[], url: string, facts: SearchPageFacts | undefined): number {
  if (!facts) return 0;
  const best = Math.max(...[facts.title, ...(facts.aliases ?? [])].map((phrase) => phraseScore(query, phrase)));
  if (demotedSearchUrls.has(url)) return best === 3 ? 3 : -1;
  return best;
}

/**
 * Reorders search results page by page: a page whose title or alias matches the query comes first,
 * and the Terms and Messages pages come last unless the query names them. Ties keep the engine order.
 */
export function rankSearchResults(
  query: string,
  results: readonly SortedResult[],
  pages: ReadonlyMap<string, SearchPageFacts>,
): SortedResult[] {
  const queryWords = words(query);
  if (queryWords.length === 0) return [...results];
  const groups: { score: number; items: SortedResult[] }[] = [];
  let current: SortedResult[] | undefined;
  for (const result of results) {
    if (result.type === 'page' || !current) {
      current = [];
      groups.push({ score: pageScore(queryWords, result.url, pages.get(result.url)), items: current });
    }
    current.push(result);
  }
  return groups
    .map((group, order) => ({ ...group, order }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .flatMap((group) => group.items);
}
