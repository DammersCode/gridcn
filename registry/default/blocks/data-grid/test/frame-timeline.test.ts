import { describe, expect, it } from "vitest";
import { flashesIn, type FrameSample } from "./frame-timeline.test-helper";

const frame = (patch: Partial<FrameSample>): FrameSample => ({ via: "frame", released: true, rows: "a\nb", placeholders: 0, groupRows: 0, empty: false, busy: false, header: "Name|Qty", rowCount: "3", colCount: "2", readonlyCells: 0, ariaReadOnly: null, ...patch });

const before = frame({});
const after = frame({ rows: "b\na", header: "Qty|Name" });

describe("flashesIn", () => {
  it("passes a timeline of the old state, then the new one", () => {
    expect(flashesIn([before, { ...before, released: false }, before, after, after], before, after)).toEqual([]);
  });

  it("flags a mixed frame that holds the new header over the old rows", () => {
    expect(flashesIn([before, frame({ header: "Qty|Name" }), after], before, after)).toHaveLength(1);
  });

  it("flags an empty state before the release, even when the new state is empty", () => {
    const empty = frame({ rows: "", empty: true, rowCount: "1" });
    expect(flashesIn([frame({ released: false }), frame({ released: false, rows: "", empty: true, rowCount: "1" }), empty], before, empty)).toHaveLength(1);
  });

  it("flags a hold that flips the read-only markers of the cells or the root", () => {
    expect(flashesIn([frame({ released: false, ariaReadOnly: "true" }), frame({ released: false, readonlyCells: 4 }), after], before, after)).toHaveLength(2);
  });

  it("flags a return to the old state after the new one", () => {
    expect(flashesIn([before, after, before, after], before, after)).toHaveLength(1);
  });
});
