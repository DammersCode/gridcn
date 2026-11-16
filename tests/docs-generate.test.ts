import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = (path: string) => readFileSync(`content/docs/${path}.mdx`, "utf8").replace(/\r\n/g, "\n");
const keyboard = () => page("(reference)/cheatsheets-messages/keyboard-shortcuts");
const messages = () => page("(reference)/cheatsheets-messages/messages");

describe("docs-generate check", () => {
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

  it("warns about Ctrl+Space on macOS", () => {
    expect(keyboard()).toContain("`Ctrl+Space`");
    expect(keyboard()).toMatch(/macOS[^\n]*input source/);
  });
});

describe("messages page", () => {
  it("has a row for the sort locale warnings of both props", () => {
    expect(messages()).toContain(String.raw`<sortLocale\|locale>`);
  });

  it("has a row for each new development warning", () => {
    for (const fragment of ["has no accessible name", "defaultData seeds the grid once", "has not settled after 30 seconds", "before the history plugin mounted", "changed identity while the editor was open", "build() found no grid", "nothing read pager"]) {
      expect(messages(), fragment).toContain(fragment);
    }
  });

  it("drops the removed class function identity warnings", () => {
    expect(messages()).not.toContain("getRowClassName identity changed");
  });
});

describe("props page", () => {
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
