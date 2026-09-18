import { describe, it, expect } from "vitest";
import { CompactSelection } from "./compact-selection";

describe("CompactSelection", () => {
  it("empty() returns a shared singleton with zero length", () => {
    const a = CompactSelection.empty();
    const b = CompactSelection.empty();
    expect(a).toBe(b);
    expect(a.length).toBe(0);
    expect(a.first()).toBeUndefined();
    expect(a.last()).toBeUndefined();
    expect(a.toArray()).toEqual([]);
  });

  describe("fromSingleSelection", () => {
    it("builds from a single index", () => {
      const s = CompactSelection.fromSingleSelection(5);
      expect(s.toArray()).toEqual([5]);
      expect(s.length).toBe(1);
    });

    it("builds from a [start, end) range", () => {
      const s = CompactSelection.fromSingleSelection([3, 7]);
      expect(s.toArray()).toEqual([3, 4, 5, 6]);
      expect(s.length).toBe(4);
    });
  });

  describe("fromArray", () => {
    it("sorts and dedupes", () => {
      const s = CompactSelection.fromArray([5, 1, 3, 1, 5]);
      expect(s.toArray()).toEqual([1, 3, 5]);
    });

    it("merges adjacent and overlapping runs", () => {
      const s = CompactSelection.fromArray([0, 1, 2, 5, 6, 10]);
      expect(s.toArray()).toEqual([0, 1, 2, 5, 6, 10]);
      expect(s.length).toBe(6);
    });

    it("returns empty for an empty array", () => {
      expect(CompactSelection.fromArray([]).length).toBe(0);
    });
  });

  describe("add", () => {
    it("adds a single index", () => {
      const s = CompactSelection.empty().add(4);
      expect(s.toArray()).toEqual([4]);
    });

    it("merges adjacent slices into one run", () => {
      const s = CompactSelection.fromSingleSelection([0, 3]).add([3, 5]);
      expect(s.toArray()).toEqual([0, 1, 2, 3, 4]);
      // internal slice count should have merged to one run (verified via equals to fromArray)
      expect(s.equals(CompactSelection.fromArray([0, 1, 2, 3, 4]))).toBe(true);
    });

    it("merges overlapping slices", () => {
      const s = CompactSelection.fromSingleSelection([0, 5]).add([3, 8]);
      expect(s.toArray()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("leaves disjoint slices separate", () => {
      const s = CompactSelection.fromSingleSelection([0, 2]).add([5, 7]);
      expect(s.toArray()).toEqual([0, 1, 5, 6]);
    });

    it("is a no-op for an empty range", () => {
      const s = CompactSelection.empty();
      expect(s.add([3, 3])).toBe(s);
    });

    it("is a no-op for a reversed (invalid) range", () => {
      const s = CompactSelection.empty();
      expect(s.add([5, 2])).toBe(s);
    });

    it("does not mutate the original instance", () => {
      const original = CompactSelection.fromSingleSelection(1);
      const added = original.add(2);
      expect(original.toArray()).toEqual([1]);
      expect(added.toArray()).toEqual([1, 2]);
    });
  });

  describe("remove", () => {
    it("removes a single index from the middle of a run, splitting it", () => {
      const s = CompactSelection.fromSingleSelection([0, 5]).remove(2);
      expect(s.toArray()).toEqual([0, 1, 3, 4]);
    });

    it("removes from the start of a run", () => {
      const s = CompactSelection.fromSingleSelection([0, 5]).remove(0);
      expect(s.toArray()).toEqual([1, 2, 3, 4]);
    });

    it("removes from the end of a run", () => {
      const s = CompactSelection.fromSingleSelection([0, 5]).remove(4);
      expect(s.toArray()).toEqual([0, 1, 2, 3]);
    });

    it("removes a range spanning multiple slices", () => {
      const s = CompactSelection.fromArray([0, 1, 2, 10, 11, 12]).remove([1, 11]);
      expect(s.toArray()).toEqual([0, 11, 12]);
    });

    it("removing a non-member range is a no-op on membership", () => {
      const s = CompactSelection.fromSingleSelection([0, 3]);
      const result = s.remove([10, 20]);
      expect(result.toArray()).toEqual([0, 1, 2]);
    });

    it("removing everything yields empty", () => {
      const s = CompactSelection.fromSingleSelection([0, 3]).remove([0, 3]);
      expect(s.length).toBe(0);
    });

    it("is a no-op for an empty range", () => {
      const s = CompactSelection.fromSingleSelection([0, 3]);
      expect(s.remove([2, 2])).toBe(s);
    });
  });

  describe("hasIndex / hasAll", () => {
    const s = CompactSelection.fromArray([0, 1, 2, 5, 6, 7]);

    it("hasIndex finds members and rejects non-members", () => {
      expect(s.hasIndex(1)).toBe(true);
      expect(s.hasIndex(6)).toBe(true);
      expect(s.hasIndex(3)).toBe(false);
      expect(s.hasIndex(-1)).toBe(false);
      expect(s.hasIndex(100)).toBe(false);
    });

    it("hasAll is true only when the whole range is covered by one run", () => {
      expect(s.hasAll([0, 3])).toBe(true);
      expect(s.hasAll([5, 8])).toBe(true);
      expect(s.hasAll([0, 8])).toBe(false); // spans the gap
      expect(s.hasAll([2, 2])).toBe(true); // empty range vacuously true
    });
  });

  describe("first / last", () => {
    it("returns bounds across multiple runs", () => {
      const s = CompactSelection.fromArray([10, 11, 3, 4, 20]);
      expect(s.first()).toBe(3);
      expect(s.last()).toBe(20);
    });
  });

  describe("length", () => {
    it("counts members, not slice count", () => {
      const s = CompactSelection.fromArray([0, 1, 2, 10, 11]);
      expect(s.length).toBe(5);
    });
  });

  describe("offset", () => {
    it("shifts all members by delta", () => {
      const s = CompactSelection.fromArray([0, 1, 5]).offset(3);
      expect(s.toArray()).toEqual([3, 4, 8]);
    });

    it("drops members that go negative on a negative shift", () => {
      const s = CompactSelection.fromArray([0, 1, 2, 5]).offset(-2);
      expect(s.toArray()).toEqual([0, 3]);
    });

    it("clamps a partially-negative slice at zero", () => {
      const s = CompactSelection.fromSingleSelection([3, 6]).offset(-5);
      expect(s.toArray()).toEqual([0]);
    });

    it("drops a slice that lands entirely negative", () => {
      const s = CompactSelection.fromSingleSelection([0, 2]).offset(-5);
      expect(s.toArray()).toEqual([]);
    });

    it("is a no-op for delta zero (identity)", () => {
      const s = CompactSelection.fromSingleSelection([1, 3]);
      expect(s.offset(0)).toBe(s);
    });
  });

  describe("toArray / iteration", () => {
    it("iterates members in ascending order via for...of", () => {
      const s = CompactSelection.fromArray([7, 0, 3, 4]);
      const collected: number[] = [];
      for (const n of s) collected.push(n);
      expect(collected).toEqual([0, 3, 4, 7]);
    });

    it("supports spreading", () => {
      const s = CompactSelection.fromSingleSelection([2, 5]);
      expect([...s]).toEqual([2, 3, 4]);
    });

    it("iterates nothing for an empty selection", () => {
      expect([...CompactSelection.empty()]).toEqual([]);
    });
  });

  describe("equals", () => {
    it("is true for selections with identical merged slices", () => {
      const a = CompactSelection.fromArray([0, 1, 2, 5]);
      const b = CompactSelection.fromSingleSelection([0, 3]).add(5);
      expect(a.equals(b)).toBe(true);
    });

    it("is false when membership differs", () => {
      const a = CompactSelection.fromArray([0, 1]);
      const b = CompactSelection.fromArray([0, 2]);
      expect(a.equals(b)).toBe(false);
    });

    it("is false when slice boundaries differ with the same slice count", () => {
      const a = CompactSelection.fromArray([0, 1, 2]);
      const b = CompactSelection.fromArray([0, 1, 2, 3]);
      // pad `a` with a disjoint second run so both have 2 slices, isolating the boundary check
      const aTwoSlices = a.add([10, 11]);
      const bTwoSlices = b.remove(3).add([10, 12]);
      expect(aTwoSlices.equals(bTwoSlices)).toBe(false);
    });

    it("is true for two empty selections", () => {
      expect(CompactSelection.empty().equals(CompactSelection.fromArray([]))).toBe(true);
    });

    it("is reflexive for the same instance", () => {
      const a = CompactSelection.fromSingleSelection(1);
      expect(a.equals(a)).toBe(true);
    });
  });

  describe("immutability", () => {
    it("every mutating op returns a new instance without touching the source", () => {
      const base = CompactSelection.fromArray([1, 2, 3]);
      const added = base.add(10);
      const removed = base.remove(2);
      const offsetted = base.offset(1);
      expect(base.toArray()).toEqual([1, 2, 3]);
      expect(added.toArray()).toEqual([1, 2, 3, 10]);
      expect(removed.toArray()).toEqual([1, 3]);
      expect(offsetted.toArray()).toEqual([2, 3, 4]);
    });
  });
});
