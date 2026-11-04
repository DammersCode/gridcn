/*
 * Model test of the refresh guard: a seeded interleaving of landings, failures, saves, edits, local row operations, server moves,
 * filter changes and unmounts, checked against the rule after every step and against the backend after a final drain.
 * Remaining exemptions, each for one reason:
 * - Duplicate ids are not checked while rows that moved on the server (or shifted locally, in sequential sources) mix with older rows,
 *   or while sibling blocks of one refresh are still in flight: positions of two snapshots overlap until the refresh settles.
 * - Holes are not checked in sequential sources in the same state: a protected row that moved across blocks cannot keep both places.
 * - A pending insert in a counted source is not required to survive a landing: it returns only into an empty slot, and the hook
 *   refreshes when its save settles, so the server decides.
 * - A repeated id in an answer leaves its later copy's slot empty (answered, never loaded); exact slots are checked for the first copy.
 * - `getRowId` that reads the index and unmount mid-flight only check that nothing throws, loops, or leaves a hole.
 */
import { StrictMode, useEffect, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, DataGridRoot, defineColumns, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsPageRequest, type ServerRowsRequest, type UseDataGridServerRowsResult, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type SourceKind = "counted" | "cursor" | "offset" | "pages";

const SEEDS = Number(process.env["PROP_SEEDS"] ?? 120);
const STEPS = 40;
const BASE_ROWS = 60;
const PAGE_SIZE = 10;
const STEP_REQUEST_CAP = 80;

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text" }] as const);

function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (max: number) => Math.floor(next() * max),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
    next,
  };
}

type ServerRow = { id: string; ver: number };
const nameOf = (row: ServerRow) => `${row.id} v${row.ver}`;

/** The fake backend: a list the test mutates between requests; every answer is a snapshot taken when the request leaves. */
function createBackend() {
  const rows: ServerRow[] = Array.from({ length: BASE_ROWS }, (_, i) => ({ id: `r${i}`, ver: 0 }));
  let nextNew = 0;
  let filter = "";
  const visible = () => (filter === "even" ? rows.filter((row) => Number(row.id.slice(1)) % 2 === 0 || row.id.startsWith("n")) : rows.slice());
  return {
    visible,
    setFilter: (next: string) => (filter = next),
    prepend: () => rows.unshift({ id: `n${nextNew++}`, ver: 0 }),
    removeById: (id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
    remove: (index: number) => rows.length > 20 && rows.splice(index % rows.length, 1),
    bump: (index: number) => {
      const row = rows[index % rows.length];
      if (row) row.ver++;
    },
    repeat: (index: number) => {
      const row = rows[index % rows.length];
      if (row) rows.splice((index * 7 + 3) % rows.length, 0, { ...row });
    },
    toRow: (row: ServerRow): Row => ({ id: row.id, name: nameOf(row) }),
  };
}

type Request = {
  label: string;
  saving0: Set<string>;
  savedSince: Set<string>;
  deleted0: Set<string>;
  deletedSince: Set<string>;
  signal: AbortSignal;
  rows: Row[];
  start: number;
  land: () => void;
  fail: () => void;
};

type Save = { id: string; resolve: () => void; reject: () => void };

type Variant = { repeatRows: boolean; indexIds: boolean; unmountAtEnd: boolean };

function createWorld(kind: SourceKind, rnd: ReturnType<typeof prng>, variant: Variant) {
  const backend = createBackend();
  const held: Request[] = [];
  const saves: Save[] = [];
  const trace: string[] = [];
  const known = new Map<string, string>();
  let store!: StoreApi<DataGridStoreState>;
  let scroll!: UseDataGridServerRowsScrollResult<Row>;
  let pages!: UseDataGridServerRowsResult<Row>;
  let setReadOnly!: (value: boolean) => void;
  let setBlockSize!: (value: number) => void;
  let filterNow = "";
  const pendingDeletes = new Set<string>();
  let shownLabel = "";
  let editCount = 0;
  let localCount = 0;
  let fetchCalls = 0;
  let dirty = false;
  let shifted = false;
  let refreshPending = false;
  let unmount: (() => void) | null = null;

  const state = () => store.getState();
  const savingIds = () => {
    const ids = new Set<string>();
    for (const [id, status] of state().saveStatus) if (status === "saving") ids.add(id);
    return ids;
  };
  let stepStartCalls = 0;
  const open = (request: Omit<Request, "saving0" | "savedSince" | "deleted0" | "deletedSince" | "label">, label: string) => {
    if (++fetchCalls - stepStartCalls > STEP_REQUEST_CAP) throw new Error("request loop");
    held.push({ ...request, label, saving0: savingIds(), savedSince: new Set(), deleted0: new Set(pendingDeletes), deletedSince: new Set() });
  };

  const fetchScroll = (request: ServerRowsRequest<number>): Promise<ServerRowsAnswer<Row, number>> => {
    const all = backend.visible();
    const { start, end } = request;
    let rows: ServerRow[];
    let extra: Partial<ServerRowsAnswer<Row, number>>;
    if (kind === "counted") {
      rows = all.slice(start, Math.min(end, all.length));
      extra = { totalRowCount: all.length };
    } else if (kind === "cursor") {
      const from = request.cursor ?? 0;
      rows = all.slice(from, from + (end - start));
      extra = { nextCursor: from + rows.length >= all.length ? null : from + rows.length };
    } else {
      rows = all.slice(start, end);
      extra = { hasMore: end < all.length };
    }
    return new Promise((resolve, reject) => {
      const mapped = rows.map(backend.toRow);
      open({ signal: request.signal, rows: mapped, start, land: () => resolve({ rows: mapped, ...extra }), fail: () => reject(new Error("boom")) }, `${start}-${end}`);
    });
  };

  const fetchPage = (request: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => {
    const all = backend.visible();
    const mapped = all.slice(request.start, request.end).map(backend.toRow);
    return new Promise((resolve, reject) => {
      open({ signal: request.signal, rows: mapped, start: 0, land: () => resolve({ rows: mapped, totalRowCount: all.length }), fail: () => reject(new Error("boom")) }, `page ${request.page} ${filterNow}`);
    });
  };

  const onSave = (change: DataChange<Row>) => {
    const op = change.ops.find((candidate) => candidate.type === "update");
    const id = op && op.type === "update" ? op.rowId : "?";
    const deletes = change.ops.filter((candidate) => candidate.type === "delete").map((candidate) => candidate.rowId);
    for (const rowId of deletes) {
      pendingDeletes.add(rowId);
      for (const request of held) request.deletedSince.add(rowId);
    }
    return new Promise<void>((resolve, reject) => {
      const settle = () => deletes.forEach((rowId) => pendingDeletes.delete(rowId));
      const persist = () => {
        for (const rowId of deletes) backend.removeById(rowId);
        if (deletes.length > 0) {
          dirty = true;
          refreshPending = false;
        }
      };
      saves.push({ id, resolve: () => (settle(), persist(), resolve()), reject: () => (settle(), reject(new Error("save failed"))) });
    });
  };
  const createRow = () => ({ id: `loc${localCount++}`, name: `local ${localCount}` });
  const getRowId = variant.indexIds ? (row: Row, index: number) => `${row.id}~${index}` : (row: Row) => row.id;

  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    useEffect(
      () =>
        store.subscribe((next, prev) => {
          if (next.saveStatus === prev.saveStatus) return;
          for (const [id, status] of next.saveStatus) {
            if (status === "saving" && prev.saveStatus.get(id) !== "saving") for (const request of held) request.savedSince.add(id);
          }
        }),
      [],
    );
    return null;
  }
  function Harness() {
    const [readOnly, setReadOnlyState] = useState(false);
    const [blockSize, setBlockSizeState] = useState(10);
    setReadOnly = setReadOnlyState;
    setBlockSize = setBlockSizeState;
    if (kind === "pages") {
      pages = useDataGridServerRows<Row>({ getRowId, fetchRows: fetchPage, defaultPageSize: PAGE_SIZE, pageSizeOptions: [PAGE_SIZE] });
      return (
        <DataGridProvider {...pages.providerProps} columns={columns} onSave={onSave} createRow={createRow} readOnly={readOnly}>
          <DataGridRoot>
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    scroll = useDataGridServerRows<Row, number>({ mode: "scroll", getRowId, fetchRows: fetchScroll, blockSize, overscan: 0 });
    return (
      <DataGridProvider {...scroll.providerProps} columns={columns} onSave={onSave} createRow={createRow} readOnly={readOnly}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(40)));
  const data = () => (kind === "pages" ? pages.providerProps.data : scroll.providerProps.data) as readonly (Row | undefined)[];
  const live = () => held.filter((request) => !request.signal.aborted);
  const server = () => (kind === "pages" ? pages : scroll);
  const loadedRanges = (): { start: number; end: number }[] => (kind === "pages" ? [{ start: 0, end: data().length }] : scroll.getLoadedRanges().map((range) => ({ ...range })));
  const copiesOf = (rows: readonly (Row | undefined)[], id: string) => rows.filter((row) => row?.id === id) as Row[];

  /** Invariants after every step. A source that mixed snapshots (rows moved on the server or locally) is consistent again once one refresh settled. */
  function checkAlways() {
    const rows = data();
    const consistent = !dirty;
    const settledLocally = !shifted;
    if (kind === "counted" || kind === "pages" || consistent) {
      for (const { start, end } of loadedRanges()) {
        for (let i = start; i < Math.min(end, rows.length); i++) expect(rows[i], `hole at ${i}`).toBeDefined();
      }
    }
    if (consistent && settledLocally && !variant.indexIds) {
      const ids = rows.filter(Boolean).map((row) => row!.id);
      expect(new Set(ids).size, `duplicate ids ${ids.filter((id, i) => ids.indexOf(id) !== i).join(",")}`).toBe(ids.length);
    }
    for (const row of rows) if (row) known.set(row.id, row.name);
  }

  /** Lands one request and asserts the rule on the rows it carries. */
  async function land(request: Request) {
    held.splice(held.indexOf(request), 1);
    if (request.signal.aborted) return;
    const preRows = data();
    const mustKeep = new Set([...request.saving0, ...request.savedSince, ...savingIds()]);
    if (state().editing) mustKeep.add(state().editing!.rowId);
    const gone = new Set([...request.deleted0, ...request.deletedSince, ...pendingDeletes]);
    const soleRequest = live().length === 0 && (kind !== "pages" || shownLabel === request.label);
    const slotsExact = (kind === "counted" || (kind === "pages" && gone.size === 0 && !variant.repeatRows)) && !variant.indexIds;
    request.land();
    await flush();
    shownLabel = request.label;
    if (variant.indexIds) return;
    const post = data();
    const carriedIds = new Set(request.rows.map((row) => row.id));
    request.rows.forEach((carried, i) => {
      const slot = kind === "pages" ? i : request.start + i;
      const copies = copiesOf(post, carried.id);
      if (gone.has(carried.id)) {
        expect(copies.length, `deleted ${carried.id} came back`).toBe(0);
        return;
      }
      if (request.rows.findIndex((row) => row.id === carried.id) !== i) return;
      if (mustKeep.has(carried.id)) {
        const before = copiesOf(preRows, carried.id);
        expect(copies.length, `protected ${carried.id} vanished (slot ${slot}, request ${request.label}, pre ${preRows.slice(0, 14).map((row) => row?.id ?? "_").join(",")}, post ${post.slice(0, 14).map((row) => row?.id ?? "_").join(",")}, carried ${request.rows.map((row) => row.id).join(",")}, protected ${[...mustKeep].join("/")})`).toBeGreaterThan(0);
        if (before.length > 0) expect(copies.some((copy) => before.some((old) => old.name === copy.name)), `protected ${carried.id} lost its local value (before ${before.map((old) => old.name).join("/")}, now ${copies.map((copy) => copy.name).join("/")}, request ${request.label})`).toBe(true);
        else expect(copies.some((copy) => copy.name === carried.name || copy.name === known.get(carried.id)), `protected ${carried.id} took a foreign value`).toBe(true);
        return;
      }
      expect(copies.some((copy) => copy.name === carried.name), `${carried.id} not replaced by the answer (slot ${slot} holds ${post[slot]?.id}, request ${request.label}, protected ${[...mustKeep].join("/")}, gone ${[...gone].join("/")}, copies ${copies.map((copy) => copy.name).join("/")})`).toBe(true);
      if (slotsExact && slot < post.length) expect(post[slot]?.id, `${carried.id} not at slot ${slot}`).toBe(carried.id);
    });
    if (soleRequest && kind === "pages") {
      for (const id of mustKeep) {
        const preSlot = preRows.findIndex((row) => row?.id === id);
        if (gone.has(id) || carriedIds.has(id) || preSlot < 0) continue;
        expect(copiesOf(post, id).length, `protected ${id} that the answer lacks vanished`).toBeGreaterThan(0);
      }
    }
  }
  const rowsById = (rows: readonly (Row | undefined)[]) => {
    const map = new Map<string, Row>();
    for (const row of rows) if (row && !map.has(row.id)) map.set(row.id, row);
    return map;
  };

  async function step() {
    const r = rnd.next();
    const liveHeld = live();
    const loadedIds = [...rowsById(data()).keys()];
    const anyId = () => (loadedIds.length > 0 ? rnd.pick(loadedIds) : null);
    const calls = fetchCalls;
    stepStartCalls = fetchCalls;
    if (r < 0.18 && liveHeld.length > 0) {
      const request = rnd.pick(liveHeld);
      trace.push(`land ${request.label}`);
      await land(request);
    } else if (r < 0.22 && liveHeld.length > 0) {
      const request = rnd.pick(liveHeld);
      trace.push(`fail ${request.label}`);
      held.splice(held.indexOf(request), 1);
      request.fail();
      await flush();
    } else if (r < 0.3) {
      trace.push("refresh");
      if (dirty) refreshPending = true;
      act(() => server().refresh());
      await flush();
    } else if (r < 0.4) {
      if (kind === "pages") {
        const page = 1 + rnd.int(4);
        trace.push(`page ${page}`);
        act(() => pages.pager.onPageChange(page));
      } else {
        const start = rnd.int(Math.max(1, data().length));
        const end = start + 5 + rnd.int(20);
        trace.push(`window ${start}-${end}`);
        act(() => scroll.gridProps.onRenderedRowsChange?.({ start, end }));
      }
      await flush();
    } else if (r < 0.44) {
      trace.push("retry");
      act(() => server().retry());
      await flush();
    } else if (r < 0.52) {
      const op = rnd.pick(["prepend", "remove", "bump", "bump", "bump", ...(variant.repeatRows ? (["repeat"] as const) : [])] as const);
      trace.push(`server ${op}`);
      if (op === "prepend") backend.prepend();
      else if (op === "remove") backend.remove(rnd.int(BASE_ROWS));
      else if (op === "repeat") backend.repeat(rnd.int(BASE_ROWS));
      else backend.bump(rnd.int(BASE_ROWS));
      if (op !== "bump") {
        dirty = true;
        refreshPending = false;
      }
    } else if (r < 0.57) {
      const id = anyId();
      if (id) {
        trace.push(`startEdit ${id}`);
        act(() => state().actions.startEditing({ rowId: id, columnId: "name" }));
      }
    } else if (r < 0.6) {
      trace.push("cancelEdit");
      act(() => state().actions.cancelEditing());
    } else if (r < 0.68) {
      const id = anyId();
      if (id) {
        trace.push(`save ${id}`);
        act(() => state().actions.commitCellValue({ rowId: id, columnId: "name" }, `${id} edit${editCount++}`));
      }
    } else if (r < 0.78 && saves.length > 0) {
      const save = saves.splice(rnd.int(saves.length), 1)[0]!;
      const reject = save.id !== "?" && rnd.chance(0.25);
      trace.push(`${reject ? "reject" : "resolve"} save ${save.id}`);
      await act(async () => (reject ? save.reject() : save.resolve()));
      await flush();
    } else if (r < 0.84) {
      const op = rnd.pick(["insert", "delete", "reorder"] as const);
      const id = anyId();
      if (id && !variant.indexIds) {
        trace.push(`local ${op} ${id}`);
        const index = data().findIndex((row) => row?.id === id);
        if (op === "insert") act(() => state().actions.insertRow(index, "below"));
        else if (op === "delete") act(() => state().actions.deleteRowsById([id]));
        else act(() => void state().actions.reorderRows(index, Math.max(0, index - 1 - rnd.int(3))));
        shifted = true;
        if (kind === "cursor" || kind === "offset") {
          dirty = true;
          refreshPending = false;
        }
        await flush();
      }
    } else if (r < 0.87) {
      const filter = rnd.pick(["", "even"]);
      trace.push(`filter ${filter || "none"}`);
      backend.setFilter(filter);
      const changed = filter !== filterNow;
      filterNow = filter;
      act(() => (kind === "pages" ? pages.gridProps.onSearchTextChange?.(filter) : scroll.gridProps.onSearchTextChange?.(filter)));
      if (changed) {
        dirty = false;
        refreshPending = false;
      }
      await flush();
    } else if (r < 0.9) {
      trace.push("toggle readOnly");
      act(() => setReadOnly(rnd.chance(0.5)));
    } else if (r < 0.93 && kind !== "pages") {
      trace.push("blockSize");
      act(() => setBlockSize(rnd.pick([10, 15, 7])));
      await flush();
    } else {
      trace.push("noop");
    }
    if (process.env["PROP_DEBUG"]) trace[trace.length - 1] += ` => [${data().slice(0, 64).map((row) => (row ? row.id.replace(/^r/, "") + (row.name.includes("edit") ? "*" : "") : "_")).join(" ")}]`;
    if (shifted && live().length === 0 && server().status !== "error") shifted = false;
    if (dirty && refreshPending && live().length === 0 && server().status !== "error") {
      dirty = false;
      refreshPending = false;
    }
    expect(fetchCalls - calls, "request loop").toBeLessThan(STEP_REQUEST_CAP);
    checkAlways();
  }

  /** Settles every save and request, refreshes, and compares the grid with the backend. */
  async function drainAndCompare() {
    trace.push("drain");
    act(() => setReadOnly(false));
    act(() => state().actions.cancelEditing());
    for (const save of saves.splice(0)) await act(async () => save.resolve());
    for (let round = 0; round < 8; round++) {
      for (const request of live().slice()) await land(request);
      held.length = 0;
      act(() => server().retry());
      await flush();
      if (live().length === 0 && server().status !== "error") break;
    }
    act(() => server().refresh());
    await flush();
    for (let round = 0; round < 8 && live().length > 0; round++) for (const request of live().slice()) await land(request);
    await flush();
    if (variant.repeatRows || variant.indexIds) return;
    const rows = data();
    const expected = backend.visible();
    const offset = kind === "pages" ? (pages.pager.page - 1) * PAGE_SIZE : 0;
    for (const { start, end } of loadedRanges()) {
      for (let i = start; i < Math.min(end, rows.length); i++) {
        const row = rows[i];
        expect(row, `hole at ${i}`).toBeDefined();
        expect(row?.id, `slot ${i} after drain`).toBe(expected[i + offset]?.id);
        expect(row?.name, `slot ${i} value after drain`).toBe(expected[i + offset] && nameOf(expected[i + offset]!));
      }
    }
    const ids = rows.filter(Boolean).map((row) => row!.id);
    expect(new Set(ids).size, "duplicate ids after drain").toBe(ids.length);
  }

  return {
    trace,
    step,
    drainAndCompare,
    start: async () => {
      unmount = render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ).unmount;
      await flush();
      const first = held[0];
      if (first) await land(first);
    },
    /** Unmounts with requests and saves in flight, then lets them all settle: nothing may throw. */
    unmountThenSettle: async () => {
      trace.push("unmount");
      unmount?.();
      for (const request of held.splice(0)) request.land();
      for (const save of saves.splice(0)) save.resolve();
      await act(async () => void (await vi.advanceTimersByTimeAsync(40)));
    },
  };
}

describe.each<SourceKind>(["counted", "cursor", "offset", "pages"])("refresh guard model, %s source", (kind) => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it(`keeps the rule over ${SEEDS} seeded interleavings`, async () => {
    const only = process.env["PROP_ONLY"] ? Number(process.env["PROP_ONLY"]) : null;
    for (let seed = only ?? 1; seed <= (only ?? SEEDS); seed++) {
      const rnd = prng(seed * 7919 + kind.length);
      const variant: Variant = { repeatRows: seed % 7 === 0, indexIds: seed % 11 === 0, unmountAtEnd: seed % 5 === 0 };
      const world = createWorld(kind, rnd, variant);
      try {
        await world.start();
        for (let i = 0; i < STEPS; i++) await world.step();
        if (variant.unmountAtEnd) await world.unmountThenSettle();
        else await world.drainAndCompare();
      } catch (error) {
        cleanup();
        throw new Error(`seed ${seed} (${kind}) failed\ntrace: ${world.trace.join(" | ")}\n${error instanceof Error ? error.message : String(error)}`);
      }
      cleanup();
    }
  }, 600_000);
});
