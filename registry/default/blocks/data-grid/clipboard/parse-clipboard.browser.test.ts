import { describe, expect, it } from "vitest";
import { parseClipboardHtml } from "./parse-clipboard";
import { serializeCells } from "./serialize-cells";

describe("parseClipboardHtml in a real browser", () => {
  it.each([
    ["a non-breaking space", "a b"],
    ["a carriage return", "a\rb"],
    ["a tab next to a non-breaking space", "a\t b"],
  ])("round-trips %s through the grid's own serialization", (_name, value) => {
    expect(parseClipboardHtml(serializeCells([[value]]).html)).toEqual([[value]]);
  });
});
