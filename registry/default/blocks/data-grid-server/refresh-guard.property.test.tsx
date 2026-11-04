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
const BLOCK = 10;
const BASE_ROWS = 60;
const PAGE_SIZE = 10;

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
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

type ServerRow = { id: string; ver: number };
const nameOf = (row: ServerRow) => `${row.id} v${row.ver}`;

/** The fake backend: a list the test mutates between requests; every answer is a snapshot taken when the request leaves. */
function createServer() {
  const rows: ServerRow[] = Array.from({ length: BASE_ROWS }, (_, i) => ({ id: `r${i}`, ver: 0 }));
  let nextNew = 0;
  let filter = "";
  const visible = () => (filter === "even" ? rows.filter((row) => Number(row.id.slice(1)) % 2 === 0) : rows.slice());
  return {
    visible,
    setFilter: (next: string) => (filter = next),
    prepend: () => rows.unshift({ id: `n${nextNew++}`, ver: 0 }),
    remove: (index: number) => rows.length > 20 && rows.splice(index % rows.length, 1),
    bump: (index: number) => {
      const row = rows[index % rows.length];
      if (row) row.ver++;
    },
    toRow: (row: ServerRow): Row => ({ id: row.id, name: nameOf(row) }),
  };
}

type Record = {
  label: string;
  saving0: Set<string>;
  editing0: string | null;
  savedSince: Set<string>;
  signal: AbortSignal;
  rows: Row[];
  start: number;
  end: number;
  land: () => void;
  fail: () => void;
};

type Save = { id: string; resolve: () => void; reject: () => void };

function createWorld(kind: SourceKind, rnd: ReturnType<typeof prng>) {
  const backend = createServer();
  const held: Record[] = [];
  const saves: Save[] = [];
  const trace: string[] = [];
  let store!: StoreApi<DataGridStoreState>;
  let scroll!: UseDataGridServerRowsScrollResult<Row>;
  let pages!: UseDataGridServerRowsResult<Row>;
  let editCount = 0;
  let refreshNext = false;

  const state = () => store.getState();
  const savingIds = () => {
    const ids = new Set<string>();
    for (const [id, status] of state().saveStatus) if (status === "saving") ids.add(id);
    return ids;
  };
  const open = (record: Omit<Record, "saving0" | "editing0" | "savedSince" | "label">, label: string) => {
    const full: Record = { ...record, label, saving0: savingIds(), editing0: state().editing?.rowId ?? null, savedSince: new Set() };
    held.push(full);
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
      open({ signal: request.signal, rows: mapped, start, end, land: () => resolve({ rows: mapped, ...extra }), fail: () => reject(new Error("boom")) }, `${start}-${end}`);
    });
  };

  const fetchPage = (request: ServerRowsPageRequest): Promise<ServerRowsAnswer<Row>> => {
    const all = backend.visible();
    const mapped = all.slice(request.start, request.end).map(backend.toRow);
    return new Promise((resolve, reject) => {
      open({ signal: request.signal, rows: mapped, start: request.start, end: request.end, land: () => resolve({ rows: mapped, totalRowCount: all.length }), fail: () => reject(new Error("boom")) }, `page ${request.page}`);
    });
  };

  const onSave = (change: DataChange<Row>) => {
    const op = change.ops.find((candidate) => candidate.type === "update");
    const id = op && op.type === "update" ? op.rowId : "?";
    return new Promise<void>((resolve, reject) => saves.push({ id, resolve, reject: () => reject(new Error("save failed")) }));
  };

  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    if (kind === "pages") {
      pages = useDataGridServerRows<Row>({ getRowId: (row) => row.id, fetchRows: fetchPage, defaultPageSize: PAGE_SIZE, pageSizeOptions: [PAGE_SIZE] });
      return (
        <DataGridProvider {...pages.providerProps} columns={columns} onSave={onSave}>
          <DataGridRoot>
            <Probe />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    scroll = useDataGridServerRows<Row, number>({ mode: "scroll", getRowId: (row) => row.id, fetchRows: fetchScroll, blockSize: BLOCK, overscan: 0 });
    return (
      <DataGridProvider {...scroll.providerProps} columns={columns} onSave={onSave}>
        <DataGridRoot>
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(40)));
  const data = () => (kind === "pages" ? pages.providerProps.data : scroll.providerProps.data) as readonly (Row | undefined)[];
  const live = () => held.filter((record) => !record.signal.aborted);
  const server = () => (kind === "pages" ? pages : scroll);

  const loadedRanges = (): { start: number; end: number }[] => {
    if (kind === "pages") return [{ start: 0, end: data().length }];
    return scroll.getLoadedRanges().map((range) => ({ ...range }));
  };

  /** Invariants that hold after every step. */
  function checkAlways() {
    const rows = data();
    for (const { start, end } of loadedRanges()) {
      for (let i = start; i < Math.min(end, rows.length); i++) expect(rows[i], `hole at ${i}`).toBeDefined();
    }
    const guardedNow = new Set([...savingIds(), ...(state().editing ? [state().editing!.rowId] : [])]);
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row) continue;
      if (guardedNow.has(row.id)) expect(seen.has(row.id), `duplicate protected row ${row.id}`).toBe(false);
      seen.add(row.id);
    }
  }

  const byId = (rows: readonly (Row | undefined)[]) => {
    const map = new Map<string, Row>();
    for (const row of rows) if (row && !map.has(row.id)) map.set(row.id, row);
    return map;
  };

  /** Lands one request and asserts the rule on the rows it carries. */
  async function land(record: Record) {
    held.splice(held.indexOf(record), 1);
    if (record.signal.aborted) return;
    const pre = byId(data());
    const mustKeep = new Set([...record.saving0, ...record.savedSince, ...savingIds()]);
    if (state().editing) mustKeep.add(state().editing!.rowId);
    const mayKeep = new Set(mustKeep);
    if (record.editing0) mayKeep.add(record.editing0);
    const expectedSlots = kind === "counted" || kind === "pages";
    record.land();
    await flush();
    const post = data();
    record.rows.forEach((carried, i) => {
      const slot = kind === "pages" ? i : record.start + i;
      if (mustKeep.has(carried.id)) {
        const before = pre.get(carried.id);
        if (before) {
          const now = byId(post).get(carried.id);
          expect(now?.name, `protected ${carried.id} lost its local value`).toBe(before.name);
          if (expectedSlots && slot < post.length && !wiped(post)) expect(post[slot]?.id, `protected ${carried.id} not at slot ${slot}`).toBe(carried.id);
        }
        return;
      }
      if (mayKeep.has(carried.id)) return;
      const now = byId(post).get(carried.id);
      expect(now?.name, `${carried.id} not replaced by the answer`).toBe(carried.name);
      if (expectedSlots && slot < post.length) expect(post[slot]?.id, `${carried.id} not at slot ${slot}`).toBe(carried.id);
    });
  }
  const wiped = (post: readonly (Row | undefined)[]) => post.every((row) => row === undefined);

  async function step() {
    let r = rnd.next();
    if (refreshNext) {
      refreshNext = false;
      r = 0.3;
    }
    const liveHeld = live();
    const loadedIds = [...byId(data()).keys()];
    const anyId = () => (loadedIds.length > 0 ? rnd.pick(loadedIds) : null);
    if (r < 0.2 && liveHeld.length > 0) {
      const record = rnd.pick(liveHeld);
      trace.push(`land ${record.label}`);
      await land(record);
    } else if (r < 0.25 && liveHeld.length > 0) {
      const record = rnd.pick(liveHeld);
      trace.push(`fail ${record.label}`);
      held.splice(held.indexOf(record), 1);
      record.fail();
      await flush();
    } else if (r < 0.33) {
      trace.push("refresh");
      act(() => server().refresh());
      await flush();
    } else if (r < 0.43) {
      if (kind === "pages") {
        const page = 1 + rnd.int(4);
        trace.push(`page ${page}`);
        act(() => pages.pager.onPageChange?.(page));
      } else {
        const start = rnd.int(Math.max(1, data().length));
        const end = start + 5 + rnd.int(20);
        trace.push(`window ${start}-${end}`);
        act(() => scroll.gridProps.onRenderedRowsChange?.({ start, end }));
      }
      await flush();
    } else if (r < 0.48) {
      trace.push("retry");
      act(() => server().retry());
      await flush();
    } else if (r < 0.54) {
      let op = rnd.pick(["prepend", "remove", "bump", "bump", "bump"] as const);
      // Rows that moved on the server are only mixed with older rows until the next refresh, so a moving change waits for an idle source and is followed by one.
      if (op !== "bump" && (live().length > 0 || server().status === "error")) op = "bump";
      else if (op !== "bump") refreshNext = true;
      trace.push(`server ${op}`);
      if (op === "prepend") backend.prepend();
      else if (op === "remove") backend.remove(rnd.int(BASE_ROWS));
      else backend.bump(rnd.int(BASE_ROWS));
    } else if (r < 0.6) {
      const id = anyId();
      if (id) {
        trace.push(`startEdit ${id}`);
        act(() => state().actions.startEditing({ rowId: id, columnId: "name" }));
      }
    } else if (r < 0.63) {
      trace.push("cancelEdit");
      act(() => state().actions.cancelEditing());
    } else if (r < 0.73) {
      const id = anyId();
      if (id) {
        trace.push(`save ${id}`);
        act(() => state().actions.commitCellValue({ rowId: id, columnId: "name" }, `${id} edit${editCount++}`));
        for (const record of held) record.savedSince.add(id);
      }
    } else if (r < 0.85 && saves.length > 0) {
      const save = saves.splice(rnd.int(saves.length), 1)[0]!;
      const reject = rnd.chance(0.25);
      trace.push(`${reject ? "reject" : "resolve"} save ${save.id}`);
      await act(async () => (reject ? save.reject() : save.resolve()));
      await flush();
    } else if (r < 0.88 && kind !== "pages") {
      const filter = rnd.pick(["", "even"]);
      trace.push(`filter ${filter || "none"}`);
      backend.setFilter(filter);
      act(() => scroll.gridProps.onSearchTextChange?.(filter));
      await flush();
    } else if (r < 0.9 && kind === "pages") {
      const filter = rnd.pick(["", "even"]);
      trace.push(`filter ${filter || "none"}`);
      backend.setFilter(filter);
      act(() => pages.gridProps.onSearchTextChange?.(filter));
      await flush();
    } else {
      trace.push("noop");
    }
    if (process.env["PROP_DEBUG"]) trace[trace.length - 1] += ` => [${data().slice(0, 24).map((row) => (row ? row.id.replace(/^r/, "") + (row.name.includes("edit") ? "*" : "") : "_")).join(" ")}]`;
    checkAlways();
  }

  /** Settles every save and request, refreshes, and compares the grid with the backend. */
  async function drainAndCompare() {
    trace.push("drain");
    act(() => state().actions.cancelEditing());
    for (const save of saves.splice(0)) await act(async () => save.resolve());
    for (let round = 0; round < 8; round++) {
      for (const record of live().slice()) await land(record);
      held.length = 0;
      act(() => server().retry());
      await flush();
      if (live().length === 0 && server().status !== "error") break;
    }
    act(() => server().refresh());
    await flush();
    for (let round = 0; round < 8 && live().length > 0; round++) for (const record of live().slice()) await land(record);
    await flush();
    const rows = data();
    const expected = backend.visible();
    for (const { start, end } of loadedRanges()) {
      for (let i = start; i < Math.min(end, rows.length); i++) {
        const row = rows[i];
        const offset = kind === "pages" ? pages.pager.page && (pages.pager.page - 1) * PAGE_SIZE : 0;
        expect(row, `hole at ${i}`).toBeDefined();
        expect(row?.id, `slot ${i} after drain`).toBe(expected[i + (offset ?? 0)]?.id);
        expect(row?.name, `slot ${i} value after drain`).toBe(expected[i + (offset ?? 0)] && nameOf(expected[i + (offset ?? 0)]!));
      }
    }
    const ids = rows.filter(Boolean).map((row) => row!.id);
    expect(new Set(ids).size, "duplicate ids after drain").toBe(ids.length);
  }

  return {
    render: async () => {
      render(<Harness />);
      await flush();
    },
    step,
    drainAndCompare,
    trace,
    first: async () => {
      const record = held[0];
      if (record) await land(record);
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
    for (let seed = Number(process.env["PROP_ONLY"] ?? 1); seed <= (process.env["PROP_ONLY"] ? Number(process.env["PROP_ONLY"]) : SEEDS); seed++) {
      const rnd = prng(seed * 7919 + kind.length);
      const world = createWorld(kind, rnd);
      try {
        await world.render();
        await world.first();
        for (let i = 0; i < STEPS; i++) await world.step();
        await world.drainAndCompare();
      } catch (error) {
        cleanup();
        throw new Error(`seed ${seed} (${kind}) failed\ntrace: ${world.trace.join(" | ")}\n${error instanceof Error ? error.message : String(error)}`);
      }
      cleanup();
    }
  }, 600_000);
});
