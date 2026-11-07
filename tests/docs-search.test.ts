import { join } from "node:path";
import { structure } from "fumadocs-core/mdx-plugins";
import { initAdvancedSearch, type AdvancedIndex } from "fumadocs-core/search/server";
import { describe, expect, it } from "vitest";
import { pageIndex, frontField } from "../scripts/docs-verify-lib.mjs";
import { demotedSearchUrls, rankSearchResults, withAliases, type SearchPageFacts } from "@/lib/docs-search";

type IndexedPage = { front: string; body: string };

const pages = pageIndex(join(__dirname, "..", "content", "docs")) as Map<string, IndexedPage>;

const aliasesOf = (front: string): string[] => {
  const raw = /^aliases:\s*(.*)$/m.exec(front)?.[1];
  return raw ? (JSON.parse(raw) as string[]) : [];
};

// Approximates the MDX index: JSX comments and component lines go before remark parses the body.
const plainBody = (body: string) => body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*<[^>]*\/?>\s*$/gm, "");

const facts = new Map<string, SearchPageFacts>();
const indexes: AdvancedIndex[] = [];
for (const [url, page] of pages) {
  const title = frontField(page.front, "title") ?? url;
  const aliases = aliasesOf(page.front);
  facts.set(url, { title, aliases });
  indexes.push(
    withAliases({ id: url, url, title, description: frontField(page.front, "description"), structuredData: structure(plainBody(page.body)) }, aliases),
  );
}
const server = initAdvancedSearch({ indexes, language: "english" });

async function topPages(query: string, count = 3) {
  const ranked = rankSearchResults(query, await server.search(query, { limit: 200 }), facts);
  return ranked.filter((result) => result.type === "page").slice(0, count).map((result) => result.url);
}

// Queries from the cold-read reviews that once ranked the Terms page first.
const readerQueries: [string, string][] = [
  ["export all rows", "/docs/import-export/export-whole-result"],
  ["optimistic", "/docs/save-server/save-revert"],
  ["retry", "/docs/scroll-mode/recover-load-errors"],
  ["freeze header", "/docs/columns/column-headers-groups"],
  ["grid shows nothing", "/docs/terms-help/fix-install-problems"],
  ["row numbers", "/docs/rows-pages-menus/row-markers"],
  ["button column", "/docs/row-examples/row-actions-example"],
  ["translate the ui", "/docs/theme-style-language/labels-i18n"],
  ["report an issue", "/docs/support-upgrades/version-policy-changelog"],
];

describe("docs search", () => {
  it.each(readerQueries)("ranks the owner page in the first three results for %s", async (query, url) => {
    expect(await topPages(query)).toContain(url);
  });

  it("ranks every page first for each of its own aliases", async () => {
    const misses: string[] = [];
    for (const [url, { aliases }] of facts) {
      for (const alias of aliases ?? []) {
        const [first] = await topPages(alias, 1);
        if (first !== url) misses.push(`${alias} -> ${first ?? "nothing"} (owner ${url})`);
      }
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it("keeps the Terms and Messages pages after the owner pages", async () => {
    for (const url of demotedSearchUrls) expect(pages.has(url)).toBe(true);
    for (const query of ["sequential source", "data mode", "commit"]) expect(demotedSearchUrls.has((await topPages(query, 1))[0] ?? "")).toBe(false);
  });
});
