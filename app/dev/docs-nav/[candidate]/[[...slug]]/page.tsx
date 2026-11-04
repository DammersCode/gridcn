import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { SCREEN_WORDS, allPages, childrenOf, loadCandidate, type Page } from "../../_lib";

const TYPE_LABEL: Record<string, string> = {
  landing: "Landing page",
  feature: "Feature page",
  task: "Task page",
  step: "Learning step",
  reference: "Reference page",
  cheatsheet: "Cheatsheet",
};

const H2_PLAN: Record<string, number> = { landing: 0, feature: 4, task: 3, step: 3, reference: 5, cheatsheet: 4 };

function Bars({ lines, seed }: { lines: number; seed: number }) {
  const widths = [100, 96, 92, 98, 84, 100, 90, 62];
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="bg-muted h-2.5 rounded-sm" style={{ width: `${widths[(i + seed) % widths.length]}%` }} />
      ))}
    </div>
  );
}

function Section({ title, id, words, seed }: { title: string; id: string; words: number; seed: number }) {
  const lines = Math.max(3, Math.round(words / 14));
  const paragraphs = Math.max(1, Math.ceil(lines / 7));
  return (
    <section>
      <h2 id={id}>{title}</h2>
      {Array.from({ length: paragraphs }, (_, i) => (
        <div key={i} className="my-4">
          <Bars lines={Math.min(7, lines - i * 7)} seed={seed + i} />
        </div>
      ))}
      {words > 700 && <div className="bg-muted/60 my-4 h-28 rounded-md border" aria-label="code sample placeholder" />}
    </section>
  );
}

function Outline({ page }: { page: Page }) {
  const count = H2_PLAN[page.type] ?? 3;
  const sections = Array.from({ length: count }, (_, i) => ({ id: `section-${i + 1}`, title: `Section ${i + 1}` }));
  const perSection = count ? Math.round((page.words * 0.8) / count) : 0;
  return (
    <>
      {page.type !== "landing" && page.type !== "cheatsheet" && (
        <div className="bg-muted/60 mb-6 flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground">Live demo placeholder</div>
      )}
      {sections.map((s, i) => (
        <Section key={s.id} id={s.id} title={s.title} words={perSection} seed={i * 3} />
      ))}
      {count === 0 && <Bars lines={4} seed={1} />}
    </>
  );
}

export default async function Page({ params }: { params: Promise<{ candidate: string; slug?: string[] }> }) {
  const { candidate, slug = [] } = await params;
  const c = loadCandidate(candidate);
  if (!c) notFound();
  const url = `/dev/docs-nav/${candidate}/${slug.join("/")}`;
  const pages = allPages(c);
  const page = pages.find((p) => p.url === url);
  if (!page) {
    const area = c.areas.find((a) => url === `/dev/docs-nav/${candidate}/${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    if (area) return <AreaHome candidate={candidate} area={area.name} groups={area.groups.map((g) => g.pages[0])} />;
    notFound();
  }
  const screens = page.words / SCREEN_WORDS;
  const children = childrenOf(c, page);
  const index = pages.findIndex((p) => p.url === url);
  const toc = Array.from({ length: H2_PLAN[page.type] ?? 3 }, (_, i) => ({ title: `Section ${i + 1}`, url: `#section-${i + 1}`, depth: 2 }));
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.area} / {page.group}
      </DocsDescription>
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 border-b pb-6 text-xs">
        <span className="rounded-md border px-2 py-1">{TYPE_LABEL[page.type] ?? page.type}</span>
        <span className="rounded-md border px-2 py-1">{page.words} words</span>
        <span className="rounded-md border px-2 py-1">about {screens.toFixed(1)} screens</span>
        <span className="rounded-md border px-2 py-1">mock content</span>
      </div>
      <DocsBody>
        {page.type === "landing" && children.length > 0 ? (
          <>
            <Bars lines={3} seed={2} />
            <div className="not-prose mt-6 grid gap-3 sm:grid-cols-2">
              {children.map((p) => (
                <Link key={p.url} href={p.url} className="hover:bg-accent rounded-md border p-4">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="mt-2">
                    <Bars lines={2} seed={p.title.length} />
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <Outline page={page} />
        )}
        <div className="not-prose mt-10 flex justify-between gap-3 border-t pt-4 text-sm">
          {index > 0 ? <Link href={pages[index - 1].url}>Previous: {pages[index - 1].title}</Link> : <span />}
          {index < pages.length - 1 ? <Link href={pages[index + 1].url}>Next: {pages[index + 1].title}</Link> : <span />}
        </div>
      </DocsBody>
    </DocsPage>
  );
}

function AreaHome({ candidate, area, groups }: { candidate: string; area: string; groups: Page[] }) {
  return (
    <DocsPage>
      <DocsTitle>{area}</DocsTitle>
      <DocsBody>
        <div className="not-prose grid gap-3 sm:grid-cols-2">
          {groups.map((p) => (
            <Link key={p.url} href={p.url} className="hover:bg-accent rounded-md border p-4 text-sm font-medium">
              {p.group}
            </Link>
          ))}
        </div>
        <p className="text-muted-foreground mt-6 text-sm">Candidate {candidate}</p>
      </DocsBody>
    </DocsPage>
  );
}
