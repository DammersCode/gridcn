import { describe, expect, it } from "vitest";
import { matchesAccept, filterFiles, type DropzoneAccept } from "./dropzone";

function makeFile(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("matchesAccept", () => {
  it("matches an exact MIME type", () => {
    expect(matchesAccept(makeFile("a.csv", "text/csv"), { "text/csv": [".csv"] })).toBe(true);
  });

  it("matches a MIME wildcard like text/*", () => {
    expect(matchesAccept(makeFile("a.txt", "text/plain"), { "text/*": [] })).toBe(true);
  });

  it("matches by extension when the browser reports an empty MIME type (.csv)", () => {
    expect(matchesAccept(makeFile("a.csv", ""), { "text/csv": [".csv"] })).toBe(true);
  });

  it("matches by extension case-insensitively", () => {
    expect(matchesAccept(makeFile("A.CSV", ""), { "text/csv": [".csv"] })).toBe(true);
  });

  it("rejects a file matching neither MIME nor extension", () => {
    expect(matchesAccept(makeFile("a.png", "image/png"), { "text/csv": [".csv"] })).toBe(false);
  });

  it("matches xlsx by its MIME type", () => {
    const accept: DropzoneAccept = { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] };
    expect(matchesAccept(makeFile("book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), accept)).toBe(true);
  });
});

describe("filterFiles", () => {
  it("accepts every file when no options are given", () => {
    const files = [makeFile("a.csv", "text/csv"), makeFile("b.png", "image/png")];
    expect(filterFiles(files, {})).toEqual({ accepted: files, rejections: [] });
  });

  it("rejects a file that fails accept with reason 'accept'", () => {
    const file = makeFile("a.png", "image/png");
    const result = filterFiles([file], { accept: { "text/csv": [".csv"] } });
    expect(result).toEqual({ accepted: [], rejections: [{ file, reasons: ["accept"] }] });
  });

  it("rejects a file over maxSize with reason 'maxSize'", () => {
    const file = makeFile("a.csv", "text/csv", 100);
    const result = filterFiles([file], { maxSize: 50 });
    expect(result).toEqual({ accepted: [], rejections: [{ file, reasons: ["maxSize"] }] });
  });

  it("rejects a file under minSize with reason 'minSize'", () => {
    const file = makeFile("a.csv", "text/csv", 5);
    const result = filterFiles([file], { minSize: 50 });
    expect(result).toEqual({ accepted: [], rejections: [{ file, reasons: ["minSize"] }] });
  });

  it("rejects files beyond maxFiles with reason 'maxFiles', keeping the first N accepted", () => {
    const files = [makeFile("a.csv", "text/csv"), makeFile("b.csv", "text/csv"), makeFile("c.csv", "text/csv")];
    const result = filterFiles(files, { maxFiles: 2 });
    expect(result.accepted).toEqual([files[0], files[1]]);
    expect(result.rejections).toEqual([{ file: files[2], reasons: ["maxFiles"] }]);
  });

  it("can report more than one rejection reason for the same file", () => {
    const file = makeFile("a.png", "image/png", 5);
    const result = filterFiles([file], { accept: { "text/csv": [".csv"] }, minSize: 50 });
    expect(result.rejections).toEqual([{ file, reasons: ["accept", "minSize"] }]);
  });
});
