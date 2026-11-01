import { describe, expect, it } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

describe.each(ALL_MODES)("result announcements in mode %s", (mode) => {
  it("a client filter announces the rows that remain, counted over the loaded rows", async () => {
    const grid = await mountMode(mode, { props: { announceResults: true } });
    grid.setFilters([...gt1] as never);
    const live = grid.state().liveAnnouncement;
    if (mode === "FS") {
      expect(live).toBeNull();
      return;
    }
    expect(live).toMatchObject({ kind: "results", count: mode === "PC" || mode === "PS" ? 2 : 4 });
    expect(live?.partial).toBeUndefined();
  });

  it("a client sort announces the order change, a server sort stays silent", async () => {
    const grid = await mountMode(mode, { props: { announceResults: true } });
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    if (mode === "SS") expect(grid.state().liveAnnouncement).toBeNull();
    else expect(grid.state().liveAnnouncement).toMatchObject({ kind: "results" });
  });

  it("a new row count from the server is announced as the result count", async () => {
    const grid = await mountMode(mode, { props: { announceResults: true, totalRowCount: 100 } });
    grid.setProps({ totalRowCount: 37 });
    expect(grid.state().liveAnnouncement).toMatchObject({ kind: "results", count: 37 });
  });

  it("stays silent without announceResults", async () => {
    const grid = await mountMode(mode);
    grid.setFilters([...gt1] as never);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(grid.state().liveAnnouncement).toBeNull();
  });
});

describe("result announcements with unloaded lazy rows", () => {
  it("marks the count as partial", async () => {
    const grid = await mountMode("Z", { props: { announceResults: true }, initialLoad: 3 });
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(grid.state().liveAnnouncement).toMatchObject({ kind: "results", partial: true });
  });
});
