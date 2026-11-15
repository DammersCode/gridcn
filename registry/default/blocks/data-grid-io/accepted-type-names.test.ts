import { describe, expect, it } from "vitest";
import { acceptedTypeNames } from "./import-dialog";

describe("acceptedTypeNames", () => {
  it("names an extension once when two MIME types list it", () => {
    expect(acceptedTypeNames({ "text/csv": [".csv"], "application/csv": [".csv", ".txt"] })).toEqual([".csv", ".txt"]);
  });
  it("falls back to the MIME types when no extension is listed", () => {
    expect(acceptedTypeNames({ "text/csv": [] })).toEqual(["text/csv"]);
  });
});
