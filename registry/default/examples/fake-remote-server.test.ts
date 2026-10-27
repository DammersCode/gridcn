import { describe, expect, it } from "vitest";
import { createRemoteServer } from "./fake-remote-server";

async function ids(server: ReturnType<typeof createRemoteServer>, count: number) {
  const { rows } = await server.fetchPage({ page: 1, pageSize: count });
  return rows.map((row) => row.id);
}

describe("createRemoteServer set filters", () => {
  it("splits the rows between isAnyOf and isNoneOf, ignoring case", async () => {
    const server = createRemoteServer();
    const { rows } = await server.fetchPage({ page: 1, pageSize: 1 });
    const role = rows[0]!.role.toUpperCase();
    const any = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isAnyOf", value: [role] }] });
    const none = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isNoneOf", value: [role] }] });

    expect(any.total).toBeGreaterThan(0);
    expect(none.total).toBeGreaterThan(0);
    expect(any.total + none.total).toBe(server.total);
  });

  it("matches every row for an empty isNoneOf list", async () => {
    const server = createRemoteServer();
    const { total } = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ columnId: "role", operator: "isNoneOf", value: [] }] });

    expect(total).toBe(server.total);
  });
});

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

describe("createRemoteServer filter groups", () => {
  it("evaluates a tree like the client: (role A or role B) and age > 30", async () => {
    const server = createRemoteServer();
    const all = await server.fetchPage({ page: 1, pageSize: 1000 });
    const [a, b] = [all.rows[0]!.role, all.rows.find((r) => r.role !== all.rows[0]!.role)!.role];
    const expected = all.rows.filter((r) => (r.role === a || r.role === b) && r.age > 30).length;
    const result = await server.fetchPage({
      page: 1,
      pageSize: 1,
      filters: [
        { columnId: "age", operator: "gt", value: "30" },
        { join: "or", filters: [{ columnId: "role", operator: "equals", value: a }, { columnId: "role", operator: "equals", value: b }] },
      ],
    });
    expect(result.total).toBe(expected);
  });

  it("an empty group matches every row, like the client", async () => {
    const server = createRemoteServer();
    const { total } = await server.fetchPage({ page: 1, pageSize: 1, filters: [{ join: "or", filters: [] }] });
    expect(total).toBe(server.total);
  });

  it("rejects a tree that is too deep, has an unknown join, or names an unknown column", async () => {
    const server = createRemoteServer();
    const leaf = { columnId: "role", operator: "equals", value: "x" };
    const deep = { join: "or" as const, filters: [{ join: "and" as const, filters: [{ join: "or" as const, filters: [leaf] }] }] };
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [deep] })).rejects.toThrow();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [{ join: "xor", filters: [leaf] } as never] })).rejects.toThrow();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: [{ ...leaf, columnId: "secret" }] })).rejects.toThrow();
  });

  it("rejects 100k empty groups before it walks them", async () => {
    const server = createRemoteServer();
    const groups = Array.from({ length: 100_000 }, () => ({ join: "or" as const, filters: [] }));
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups })).rejects.toThrow("invalid filter group");
  });

  it("accepts 16 groups and rejects the 17th", async () => {
    const server = createRemoteServer();
    const groups = (n: number) => Array.from({ length: n }, () => ({ join: "or" as const, filters: [] }));
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups(16) })).resolves.toBeDefined();
    await expect(server.fetchPage({ page: 1, pageSize: 1, filters: groups(17) })).rejects.toThrow("invalid filter group");
  });
});
