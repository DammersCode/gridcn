// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MAX_WRITE_REJECTIONS } from "@/registry/default/blocks/data-grid/store/write-ack";
import { type ValidatedChange, type WriteCounts, defineColumnMap } from "./data-grid-server-query";
import { DEFAULT_LIMITS, createGridQuery, type Predicate, type QueryExecutor } from "./data-grid-server-query-sdk";
import { handleGridRequest } from "./handle-grid-request";

const post = (bytes: number) => new Request("http://x/", { method: "POST", body: JSON.stringify({ pad: "x".repeat(bytes) }) });
const echo = async () => ({ ok: true });
const selectionLike = Object.assign(async () => ({ ok: true }), { maxBodyBytes: 8 * 1024 * 1024 });

describe("handleGridRequest body cap", () => {
  it("reads the run's own cap when the route passes none", async () => {
    expect((await handleGridRequest(post(600 * 1024), selectionLike)).status).toBe(200);
    expect((await handleGridRequest(post(600 * 1024), echo)).status).toBe(413);
  });

  it("lets the route's cap win over the run's", async () => {
    expect((await handleGridRequest(post(2048), selectionLike, { maxBodyBytes: 1024 })).status).toBe(413);
  });
});

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text" },
  qty: { type: "number", numeric: "int2" },
  tenant: { type: "number", numeric: "int4", serverOnly: true },
});
const executor = { where: (plan: { where: Predicate }) => plan.where } as unknown as QueryExecutor<Predicate, unknown>;
const query = createGridQuery<Record<string, unknown>, { tenant: number }, Predicate>({ columns, executor, rowScope: (context) => ({ tenant: context.tenant }) });
const context = { tenant: 7 };
const saveRequest = (ops: unknown[]) => new Request("http://x/", { method: "POST", body: JSON.stringify({ ops, source: "edit" }) });
const update = (rowId: string, cells: [string, unknown][]) => ({ type: "update", rowId, row: {}, prev: {}, cells: cells.map(([columnId, value]) => ({ columnId, value, prev: null })) });
const counted = (counts: (change: ValidatedChange<Predicate>) => WriteCounts) => async (change: ValidatedChange<Predicate>) => counts(change);
const save = async (ops: unknown[], counts: (change: ValidatedChange<Predicate>) => WriteCounts) => {
  const response = await handleGridRequest(saveRequest(ops), query.save(counted(counts)), { context });
  return { status: response.status, body: await response.json() };
};
const notFound = (rowId: string) => ({ rowId, code: "not-found", message: "Not found" });

describe("handleGridRequest with save", () => {
  it("hands apply the validated change and the context, and accepts every matched write", async () => {
    let seen: { change: ValidatedChange<Predicate>; tenant: number | undefined } | undefined;
    const apply = async (change: ValidatedChange<Predicate>, opts: { context: { tenant: number } }) => {
      seen = { change, tenant: opts.context.tenant };
      return { updates: [1], deletes: [1n], moves: [1] };
    };
    const ops = [update("1", [["name", "Bo"]]), { type: "delete", rowId: "2" }, { type: "move", rowId: "3", beforeRowId: "1" }];
    const response = await handleGridRequest(saveRequest(ops), query.save(apply), { context });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rejected: [] });
    expect(seen?.tenant).toBe(7);
    expect(seen?.change).toEqual(query.validateChange({ ops }, { context }));
  });

  it("refuses a write that matched no row as not-found, once per row id", async () => {
    const ops = [update("1", [["name", "Bo"]]), { type: "move", rowId: "1", afterRowId: "2" }, { type: "delete", rowId: "2" }];
    await expect(save(ops, () => ({ updates: [0], deletes: [0], moves: [0n] }))).resolves.toEqual({ status: 200, body: { rejected: [notFound("1"), notFound("2")] } });
  });

  it("keeps the validation refusals and adds not-found only for the unmatched writes", async () => {
    const ops = [update("1", [["name", "Bo"], ["qty", "x"]]), update("2", [["name", "Al"]]), update("new-0", [["name", "Cy"]])];
    const { body } = await save(ops, () => ({ updates: [1, 0], deletes: [], moves: [] }));
    expect(body.rejected).toEqual([
      { rowId: "1", columnId: "qty", code: "not-a-number", message: "Not a number" },
      { rowId: "new-0", code: "not-an-id", message: "Not a valid id" },
      notFound("2"),
    ]);
  });

  it("answers limit-exceeded when the not-found refusals push the answer over the grid's bound", async () => {
    const ops = Array.from({ length: MAX_WRITE_REJECTIONS }, (_, index) => update(String(index + 1), [["name", "Bo"], ["qty", "x"]]));
    const unmatched = (change: ValidatedChange<Predicate>) => ({ updates: change.updates.map(() => 0), deletes: [], moves: [] });
    await expect(save(ops, unmatched)).resolves.toEqual({ status: 400, body: { error: "limit-exceeded", path: ["ops"] } });
    const matched = (change: ValidatedChange<Predicate>) => ({ updates: change.updates.map(() => 1), deletes: [], moves: [] });
    expect((await save(ops, matched)).body.rejected).toHaveLength(MAX_WRITE_REJECTIONS);
  });

  it("answers a bare server error when apply throws or miscounts", async () => {
    const throwing = query.save(async () => {
      throw new Error("relation users_secret does not exist");
    });
    const response = await handleGridRequest(saveRequest([update("1", [["name", "Bo"]])]), throwing, { context });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(JSON.stringify({ error: "server-error" }));
    await expect(save([update("1", [["name", "Bo"]])], () => ({ updates: [], deletes: [], moves: [] }))).resolves.toEqual({ status: 500, body: { error: "server-error" } });
    await expect(save([update("1", [["name", "Bo"]])], () => ({ updates: [-1], deletes: [], moves: [] }))).resolves.toEqual({ status: 500, body: { error: "server-error" } });
  });

  it("reads a save body up to maxChangeBytes, above the default cap of other requests", async () => {
    const run = query.save(async () => ({ updates: [], deletes: [], moves: [] }));
    expect(run.maxBodyBytes).toBe(DEFAULT_LIMITS.maxChangeBytes);
    const big = new Request("http://x/", { method: "POST", body: JSON.stringify({ ops: [], pad: "x".repeat(600 * 1024) }) });
    expect((await handleGridRequest(big, run, { context })).status).toBe(200);
    const capped = createGridQuery<Record<string, unknown>, never, Predicate>({ columns, executor, limits: { maxChangeBytes: 64 } });
    const response = await handleGridRequest(saveRequest([update("1", [["name", "x".repeat(100)]])]), capped.save(async () => ({ updates: [1], deletes: [], moves: [] })));
    expect(response.status).toBe(413);
  });
});
