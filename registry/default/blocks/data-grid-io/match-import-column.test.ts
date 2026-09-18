import { describe, expect, it } from "vitest";
import { matchImportColumns, applyImportOptions, type ImportTargetColumn } from "./match-import-column";

function makeColumns(): ImportTargetColumn[] {
  return [
    { id: "name", header: "Name" },
    { id: "email", header: "Email Address", headerText: "Email" },
    { id: "age", header: "Age" },
  ];
}

describe("matchImportColumns", () => {
  it("matches an exact header (case-sensitive input)", () => {
    expect(matchImportColumns(["Name", "Email", "Age"], makeColumns())).toEqual(["name", "email", "age"]);
  });

  it("matches case-insensitively", () => {
    expect(matchImportColumns(["NAME", "email", "AgE"], makeColumns())).toEqual(["name", "email", "age"]);
  });

  it("prefers headerText over the ReactNode/string header when both could match", () => {
    // "Email" only matches via headerText, not the (overridden) `header` field.
    expect(matchImportColumns(["Email"], makeColumns())).toEqual(["email"]);
  });

  it("falls back to matching the column id when no header text matches", () => {
    expect(matchImportColumns(["age"], makeColumns())).toEqual(["age"]);
  });

  it("maps an unmatched header to null (dialog's skip option)", () => {
    expect(matchImportColumns(["Unknown Column"], makeColumns())).toEqual([null]);
  });

  it("trims whitespace before matching", () => {
    expect(matchImportColumns(["  Name  "], makeColumns())).toEqual(["name"]);
  });

  it("returns one entry per import header, independent of grid column count", () => {
    expect(matchImportColumns(["Name", "Unknown"], makeColumns())).toEqual(["name", null]);
  });

  it("falls back to the column id for matching when header is not a string and there is no headerText", () => {
    const columns: ImportTargetColumn[] = [{ id: "score", header: () => null }];
    expect(matchImportColumns(["score"], columns)).toEqual(["score"]);
  });

  it("keeps the first match for a grid column and skips later duplicates", () => {
    expect(matchImportColumns(["Name", "name", "Email"], makeColumns())).toEqual(["name", null, "email"]);
  });

  it("dedupes duplicates matched via the column-id fallback too", () => {
    const columns: ImportTargetColumn[] = [{ id: "score", header: "Score" }];
    expect(matchImportColumns(["Score", "score"], columns)).toEqual(["score", null]);
  });
});

describe("applyImportOptions", () => {
  it("matches the built-in behavior when no options are given (zero behavior change when omitted)", () => {
    const headers = ["Name", "Email", "Unknown"];
    expect(applyImportOptions(headers, makeColumns())).toEqual(matchImportColumns(headers, makeColumns()));
    expect(applyImportOptions(headers, makeColumns(), {})).toEqual(matchImportColumns(headers, makeColumns()));
  });

  it("defaultSkipColumns by header name (case-insensitive) forces a skip even when the header matches", () => {
    const result = applyImportOptions(["Name", "Email", "Age"], makeColumns(), { defaultSkipColumns: ["EMAIL"] });
    expect(result).toEqual(["name", null, "age"]);
  });

  it("defaultSkipColumns by 0-based index forces a skip", () => {
    const result = applyImportOptions(["Name", "Email", "Age"], makeColumns(), { defaultSkipColumns: [2] });
    expect(result).toEqual(["name", "email", null]);
  });

  it("an index in defaultSkipColumns past the last header is a no-op (out of range)", () => {
    const result = applyImportOptions(["Name", "Email"], makeColumns(), { defaultSkipColumns: [99] });
    expect(result).toEqual(["name", "email"]);
  });

  it("mapColumn wins over defaultSkipColumns", () => {
    const result = applyImportOptions(["Name", "Email"], makeColumns(), {
      defaultSkipColumns: ["Name"],
      mapColumn: (header) => (header === "Name" ? "name" : undefined),
    });
    expect(result).toEqual(["name", "email"]);
  });

  it("mapColumn returning undefined falls back to the built-in matcher's result", () => {
    const result = applyImportOptions(["Name", "Email"], makeColumns(), {
      mapColumn: () => undefined,
    });
    expect(result).toEqual(["name", "email"]);
  });

  it("mapColumn returning null skips the column, overriding a successful built-in match", () => {
    const result = applyImportOptions(["Name", "Email"], makeColumns(), {
      mapColumn: (header) => (header === "Name" ? null : undefined),
    });
    expect(result).toEqual([null, "email"]);
  });

  it("mapColumn can map a header the built-in matcher would have skipped", () => {
    const result = applyImportOptions(["Unknown Column"], makeColumns(), {
      mapColumn: () => "age",
    });
    expect(result).toEqual(["age"]);
  });

  it("mapColumn receives the header text and 0-based index", () => {
    const seen: { header: string; index: number }[] = [];
    applyImportOptions(["Name", "Email"], makeColumns(), {
      mapColumn: (header, index) => {
        seen.push({ header, index });
        return undefined;
      },
    });
    expect(seen).toEqual([
      { header: "Name", index: 0 },
      { header: "Email", index: 1 },
    ]);
  });

  it("duplicate-claim dedup from matchImportColumns still applies before options run", () => {
    // both "Name" and "name" would match the same grid column; the second stays null from the matcher,
    // and defaultSkipColumns naming a different header doesn't resurrect it.
    const result = applyImportOptions(["Name", "name"], makeColumns(), { defaultSkipColumns: ["Email"] });
    expect(result).toEqual(["name", null]);
  });
});
