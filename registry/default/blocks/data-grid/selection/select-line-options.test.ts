import { describe, expect, it } from "vitest";
import { CompactSelection } from "./compact-selection";
import { selectLine } from "./select-line-options";

describe("selectLine", () => {
  it("plain click on a fresh channel selects just that index", () => {
    const result = selectLine(CompactSelection.empty(), 3, {});
    expect(result.toArray()).toEqual([3]);
  });

  it("plain click on the sole selected index toggles it off", () => {
    const result = selectLine(CompactSelection.fromSingleSelection(3), 3, {});
    expect(result.toArray()).toEqual([]);
  });

  it("plain click on a different index replaces a multi-selection with just that index", () => {
    const result = selectLine(CompactSelection.fromArray([1, 2, 3]), 5, {});
    expect(result.toArray()).toEqual([5]);
  });

  it("additive click adds a new index to the channel", () => {
    const result = selectLine(CompactSelection.fromSingleSelection(1), 3, { additive: true });
    expect(result.toArray()).toEqual([1, 3]);
  });

  it("additive click on an already-selected index removes it", () => {
    const result = selectLine(CompactSelection.fromArray([1, 3]), 3, { additive: true });
    expect(result.toArray()).toEqual([1]);
  });

  it("extendFromLast ranges from the explicit `from` index to the clicked index", () => {
    const result = selectLine(CompactSelection.fromSingleSelection(2), 5, { extendFromLast: true, from: 2 });
    expect(result.toArray()).toEqual([2, 3, 4, 5]);
  });

  it("extendFromLast falls back to the channel's last member when `from` is omitted", () => {
    const result = selectLine(CompactSelection.fromArray([1, 2]), 5, { extendFromLast: true });
    expect(result.toArray()).toEqual([1, 2, 3, 4, 5]);
  });

  it("extendFromLast falls back to `index` itself when the channel is empty and `from` is omitted", () => {
    const result = selectLine(CompactSelection.empty(), 4, { extendFromLast: true });
    expect(result.toArray()).toEqual([4]);
  });

  it("extendFromLast handles a backward range (clicked index before `from`)", () => {
    const result = selectLine(CompactSelection.fromSingleSelection(5), 2, { extendFromLast: true, from: 5 });
    expect(result.toArray()).toEqual([2, 3, 4, 5]);
  });
});
