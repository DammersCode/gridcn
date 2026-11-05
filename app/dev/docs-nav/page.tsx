import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATES, loadCandidate } from "./_lib";

const SCORES: Record<string, { beginner: string; senior: string; pros: string; cons: string }> = {
  a: {
    beginner: "8.81",
    senior: "8.63",
    pros: "Best beginner score of the last two rounds and best senior score of the last round; a feature page keeps concept and examples together; learning path 9.5 with the beginner.",
    cons: "Feature pages run 900 to 1,200 words; several groups sit at 7 pages; server pages stay feature-shaped.",
  },
  b: {
    beginner: "8.44",
    senior: "8.47",
    pros: "Every title says what the reader does; task pages stay at or below 800 words; lookups live on reference pages.",
    cons: "Lowest consistency and growth scores (8 each); concepts sit apart from tasks; option tables move to reference pages.",
  },
  c: {
    beginner: "n/a",
    senior: "7.63",
    pros: "One tab fewer; performance and support are two clicks from the home page.",
    cons: "Learn hides support facts; wrong-tab guesses; no room left for new Learn groups.",
  },
};

const startUrl = (id: string) => loadCandidate(id)?.areas[0].groups[0].pages[0].url ?? "/dev/docs-nav";

const METRIC_KEY: Record<string, string> = { a: "topics", b: "tasks", c: "fourAreas" };

export default function Page() {
  const metrics = JSON.parse(readFileSync(join(process.cwd(), "research/docs-navigation/metrics.json"), "utf8"));
  const rows: [string, string][] = [
    ["Pages", "pages"],
    ["Sidebar areas", "areas"],
    ["Groups", "groups"],
    ["Most rows visible at once", "maxRowsVisible"],
    ["Longest page (words)", "maxWords"],
    ["Average page (words)", "avgWords"],
    ["Pages above 5 screens", "over5Screens"],
  ];
  const ids = Object.keys(CANDIDATES);
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-sm">
      <h1 className="mb-2 text-2xl font-semibold">Docs navigation prototypes</h1>
      <p className="text-muted-foreground mb-6">
        Real sidebar and page layout with mock content. Planned word counts set the mock scroll length. Development only.
      </p>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {ids.map((id) => (
          <div key={id} className="rounded-md border p-4">
            <h2 className="text-base font-medium">{CANDIDATES[id].label}</h2>
            <p className="text-muted-foreground mt-1">{CANDIDATES[id].summary}</p>
            <p className="mt-3">
              Beginner {SCORES[id].beginner} / Senior {SCORES[id].senior}
            </p>
            <p className="mt-3">Pro: {SCORES[id].pros}</p>
            <p className="mt-2">Con: {SCORES[id].cons}</p>
            <Link className="mt-4 inline-block underline" href={startUrl(id)}>
              Open prototype
            </Link>
          </div>
        ))}
      </div>
      <table className="w-full border text-left">
        <thead>
          <tr className="border-b">
            <th className="p-2">Measure</th>
            <th className="p-2">Today</th>
            {ids.map((id) => (
              <th key={id} className="p-2">
                {CANDIDATES[id].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key]) => (
            <tr key={key} className="border-b">
              <td className="p-2">{label}</td>
              <td className="p-2">{metrics.current[key]}</td>
              {ids.map((id) => (
                <td key={id} className="p-2">
                  {metrics[METRIC_KEY[id]][key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted-foreground mt-4">
        Planned screens count prose only (250 words per screen). Today's numbers include code. Full write-up:
        research/docs-navigation-comparison.md.
      </p>
    </main>
  );
}
