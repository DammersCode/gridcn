import { expect, it } from "vitest";
import { COLUMN_BORDER } from "./column-border";

it("an end-pinned cell draws its divider on the start side through data-pinned=end", () => {
  expect(COLUMN_BORDER).toContain("data-[pinned=end]:border-s");
  expect(COLUMN_BORDER).toContain("data-[pinned=end]:border-e-0");
  expect(COLUMN_BORDER).not.toMatch(/pinned=(left|right)/);
});
