import { describe, expect, it } from "vitest";
import { createRemoteServer } from "./fake-remote-server";

async function ids(server: ReturnType<typeof createRemoteServer>, count: number) {
  const { rows } = await server.fetchPage({ page: 1, pageSize: count });
  return rows.map((row) => row.id);
}

describe("createRemoteServer applyOps", () => {
  it("applies a two-move batch with snapshot positions", async () => {
    const server = createRemoteServer();
    const { rows } = await server.fetchPage({ page: 1, pageSize: 6 });
    const [r0, r1] = rows;
    server.applyOps([
      { type: "move", rowId: r0!.id, row: r0!, from: 0, to: 3 },
      { type: "move", rowId: r1!.id, row: r1!, from: 1, to: 4 },
    ]);

    expect(await ids(server, 6)).toEqual(["row-2", "row-3", "row-4", "row-0", "row-1", "row-5"]);
  });
});
