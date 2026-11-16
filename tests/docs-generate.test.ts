import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = (path: string) => readFileSync(`content/docs/${path}.mdx`, "utf8").replace(/\r\n/g, "\n");
const keyboard = () => page("(reference)/cheatsheets-messages/keyboard-shortcuts");
const MESSAGE_PAGES = ["index", "setup", "data", "grid-parts", "thrown-errors", "server", "addons", "shown-text"];
const messages = () => MESSAGE_PAGES.map((name) => page(`(reference)/cheatsheets-messages/messages/${name}`)).join("\n");
// The generator compiles the blocks with TypeScript: about 1 s alone, several seconds under a parallel run.
const GENERATOR_TIMEOUT_MS = 60_000;

describe("docs-generate check", { timeout: GENERATOR_TIMEOUT_MS }, () => {
  it("finds no stale page and no message without a row", () => {
    expect(() => execFileSync("node", ["scripts/docs-generate.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
});

describe("keyboard shortcuts page", () => {
  it("lists the default keys from the source", () => {
    expect(keyboard()).toContain("`Shift+Alt+Enter`");
    expect(keyboard()).not.toContain("`Ctrl+H`");
    expect(keyboard()).not.toContain("commitDown");
  });

  it("names the keymap of the shortcuts dialog", () => {
    expect(keyboard()).toMatch(/Open the shortcuts dialog \| `\?`[^\n]*\| `openKeybindings`/);
  });

  it("names the add-on of the toolbar search key", () => {
    expect(keyboard()).toMatch(/Focus the toolbar search[^\n]*`focusSearch`/);
    expect(keyboard()).toMatch(/Search | `Mod+F` with `DataGridSearch`\| `Mod\+F` with `DataGridSearch`/);
  });

  it("says that find and replace takes Mod+F from the toolbar search", () => {
    expect(keyboard()).toContain("the toolbar search loses `Mod+F`");
  });

  it("does not claim that Ctrl+F matches on macOS", () => {
    expect(keyboard()).not.toContain("Ctrl+F");
  });

  it("lists the find panel keys", () => {
    expect(keyboard()).toMatch(/Use the find panel/);
  });

  it("warns about Ctrl+Space on macOS and Windows", () => {
    expect(keyboard()).toContain("`Ctrl+Space`");
    expect(keyboard()).toMatch(/input source on macOS and toggle the IME on Windows/);
  });
});

describe("messages page", () => {
  it("has a row for the sort locale warnings of both props", () => {
    expect(messages()).toContain(String.raw`<sortLocale\|locale>`);
  });

  it("has a row for each new development warning", () => {
    for (const fragment of ["has no accessible name", "defaultData seeds the grid once", "has not settled after 30 seconds", "before the history plugin mounted", "build() found no grid", "nothing read pager"]) {
      expect(messages(), fragment).toContain(fragment);
    }
  });

  it("gives every row an anchor", () => {
    const rows = messages().split("\n").filter((line) => line.startsWith("| <span id="));
    const ids = rows.map((row) => /^\| <span id="([^"]+)" \/>/.exec(row)?.[1]);
    expect(rows.length).toBeGreaterThan(100);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names the last column of the shown text table by when it shows", () => {
    expect(messages()).toContain("| Message | When it shows | Page |");
  });

  it("has a row for the rejected fetchRows error", () => {
    expect(messages()).toContain("fetchRows rejected");
  });

  it("drops the removed class function identity warnings", () => {
    expect(messages()).not.toContain("getRowClassName identity changed");
  });
});

describe("props page", { timeout: GENERATOR_TIMEOUT_MS }, () => {
  it("reads the JSDoc of the named type, not the first member of that name", async () => {
    const { jsdocOf } = await import("../scripts/docs-generate.mjs");
    const file = "registry/default/blocks/data-grid/types.ts";
    expect(jsdocOf(file, "ColumnDef", "filter")).toContain("Filter capabilities of this column");
    expect(jsdocOf(file, "CellType", "filter")).toContain("Filter capabilities for this type");
  });

  it("writes a default as a code span", () => {
    const props = page("(reference)/cheatsheets-messages/props-z");
    expect(props).not.toMatch(/Default (true|false|\d)/);
  });
});

describe("terms page", () => {
  const terms = () => page("(learn)/terms-help/terms");
  const termRows = () => {
    const text = terms();
    const body = text.slice(text.indexOf("## Terms [#terms]"), text.indexOf("## Other words"));
    return body.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| Term") && !line.startsWith("| ---"));
  };
  const termOf = (row: string) => row.split(" | ")[0]!.slice(2).replaceAll("`", "");

  it("lists the terms from A to Z", () => {
    const names = termRows().map(termOf);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("keeps the full meaning of a term", () => {
    expect(terms()).toContain("its `id` field, or the value that `getRowId` returns");
    expect(terms()).toContain("`useDataGridServerRows({ mode: \"scroll\", source: \"sequential\" })`");
  });

  it("writes an identifier term as code", () => {
    expect(termRows().map(termOf)).toContain("clearContents");
    expect(terms()).toMatch(/\| `clearContents` \|/);
    expect(terms()).toMatch(/\| `typeToReplace` \|/);
  });

  it("names a word for one term only", () => {
    const text = terms();
    const body = text.slice(text.indexOf("## Other words"), text.indexOf("## Search words"));
    const words = body.split("\n").filter((line) => line.startsWith("| `")).map((line) => line.split(" | ")[0]);
    expect(words.filter((word, i) => words.indexOf(word) !== i)).toEqual([]);
  });

  it("defines the sort locale, push verdict, soft rule, and blocking rule", () => {
    for (const term of ["sort locale", "push verdict", "soft rule", "blocking rule", "filter menu"]) expect(termRows().map(termOf), term).toContain(term);
  });

  it("says start side for the row marker", () => {
    expect(terms()).not.toContain("left edge");
  });
});

describe("task finder page", () => {
  const finder = () => page("(learn)/terms-help/task-finder");

  it("names the data intent as a task", () => {
    expect(finder()).toContain("## Load and save data [#data-fetching]");
  });

  it("offers row markers, the context menu, and keyboard navigation", () => {
    for (const text of ["Show row numbers, checkboxes, and drag handles", "Add a right-click menu to cells", "Move around the grid with the keyboard"]) expect(finder()).toContain(`[${text}]`);
  });

  it("gives every entry a task phrase, not the noun title of its page", () => {
    const entries = [...finder().split("## Related")[0]!.matchAll(/^- \[([^\]]+)\]\(/gm)].map((m) => m[1]!);
    const nouns = ["Sorting", "Filtering", "Quick search", "Find and replace", "URL state", "Saved views", "Validation", "Lookup cell", "Clipboard", "Fill handle", "Undo and redo", "Checked rows", "Column sizing", "Column visibility", "Row operations", "Pinned rows", "Client pagination", "Import", "Export", "Data modes", "Fetch cache"];
    expect(entries.length).toBeGreaterThan(40);
    expect(entries.filter((text) => nouns.includes(text))).toEqual([]);
  });
});

describe("exported types coverage", { timeout: GENERATOR_TIMEOUT_MS }, () => {
  it("reads type names from a barrel", async () => {
    const { exportedTypeNames } = await import("../scripts/docs-generate.mjs");
    const barrel = 'export type { A, B as C } from "./a";\nexport { x, type D } from "./b";\nexport type E = number;';
    expect(exportedTypeNames(barrel).sort()).toEqual(["A", "C", "D", "E"]);
  });

  it("names every exported type of the data-grid barrel on a docs page", () => {
    const types = page("(reference)/types-hooks/exported-types") + page("(reference)/types-hooks/layout-display-types");
    for (const name of ["ColumnPin", "ViewIndex", "CellPatch", "RowActionResult", "HeaderFilterRenderer"]) expect(types, name).toContain("`" + name);
  });
});

describe("hooks page", () => {
  const hooks = () => page("(reference)/cheatsheets-messages/hooks-z");

  it("is generated", () => {
    expect(hooks()).toContain("Generated by scripts/docs-generate.mjs");
  });

  it("lists useDataGridKeybindings and useDataGridRowOps", () => {
    expect(hooks()).toContain("| `useDataGridKeybindings` |");
    expect(hooks()).toContain("| `useDataGridRowOps` |");
  });

  it("names the source item of an add-on hook and says how to import it", () => {
    expect(hooks()).toContain("## Add-on hooks and factories");
    expect(hooks()).toContain("| Hook | Source | Purpose | Page |");
    expect(hooks()).toMatch(/\| `useDataGridHistory` \| `data-grid-history` \|/);
    expect(hooks()).toContain("Import an add-on hook from the barrel of its item");
  });
});

describe("options page", () => {
  const options = () => page("(reference)/cheatsheets-messages/options-z");

  it("is generated and lists one row per option from A to Z", () => {
    const text = options();
    expect(text).toContain("Generated by scripts/docs-generate.mjs");
    const body = text.slice(text.indexOf("## By name"), text.indexOf("## By add-on"));
    const names = [...body.matchAll(/^\| <span id="[^"]+" \/>`([^`]+)` \|/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(100);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("keeps the view grouped by add-on", () => {
    expect(options()).toContain("## By add-on [#by-add-on]");
    expect(options()).toContain("### Server");
  });
});

describe("docs-generate write mode", { timeout: GENERATOR_TIMEOUT_MS }, () => {
  it("leaves current pages untouched, including CRLF checkouts", () => {
    const file = "content/docs/(reference)/cheatsheets-messages/messages/index.mdx";
    const original = readFileSync(file);
    const crlf = Buffer.from(original.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"));
    writeFileSync(file, crlf);
    try {
      execFileSync("node", ["scripts/docs-generate.mjs"], { stdio: "pipe" });
      expect(readFileSync(file).equals(crlf)).toBe(true);
    } finally {
      writeFileSync(file, original);
    }
  });
});
