import { applyChange, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export type RemoteSort = { columnId: string; direction: "asc" | "desc" };
export type RemoteFilter = { columnId: string; operator: string; value?: string | [string, string] | string[] };
export type RemoteFilterGroup = { join: "and" | "or"; not?: boolean; filters: readonly RemoteFilterNode[] };
export type RemoteFilterNode = RemoteFilter | RemoteFilterGroup;
export type RemoteQuery = {
  page: number;
  pageSize: number;
  search?: string;
  sorts?: readonly RemoteSort[];
  filters?: readonly RemoteFilterNode[];
  signal?: AbortSignal;
};

const LATENCY_MS = 300;
const MAX_FILTER_DEPTH = 2;
const MAX_FILTER_LEAVES = 64;
const MAX_FILTER_GROUPS = 16;
const DEMO_FILTERABLE_COLUMNS: ReadonlySet<string> = new Set(["id", "name", "email", "age", "active", "role", "joined", "score"]);

const isGroup = (node: RemoteFilterNode): node is RemoteFilterGroup => "filters" in node;

/** Checks an untrusted filter tree before it is evaluated: depth, group count, leaf count, and join values. A real server also caps the request body size. */
function assertFilterTree(nodes: readonly RemoteFilterNode[], allowed: ReadonlySet<string>): void {
  let leaves = 0;
  let groups = 0;
  const walk = (list: readonly RemoteFilterNode[], depth: number) => {
    if (!Array.isArray(list)) throw new Error("invalid filter tree");
    for (const node of list as readonly RemoteFilterNode[]) {
      if (isGroup(node)) {
        if (depth >= MAX_FILTER_DEPTH || ++groups > MAX_FILTER_GROUPS || (node.join !== "and" && node.join !== "or")) throw new Error("invalid filter group");
        walk(node.filters, depth + 1);
      } else {
        if (!allowed.has(node.columnId) || ++leaves > MAX_FILTER_LEAVES) throw new Error("invalid filter");
      }
    }
  };
  walk(nodes, 0);
}

function delay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, LATENCY_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/**
 * Fake "database" of 1,000 rows behind a 300 ms round trip for the server-side examples:
 * `fetchPage` applies search/filter/sort on the "server" and returns one page plus the total;
 * `applyOps` writes the grid's committed operations back into the store (a stand-in for your API route),
 * so edits survive a refetch. `rows` replaces the people rows, and every key of its first row is filterable.
 */
export function createRemoteServer<T extends { id: string }>(options: { rows: readonly T[] }): RemoteServer<T>;
export function createRemoteServer(): RemoteServer<DemoRow>;
export function createRemoteServer<T extends { id: string }>(options: { rows?: readonly T[] } = {}): RemoteServer<T> {
  return createServer(options);
}

export type RemoteServer<T extends { id: string } = DemoRow> = ReturnType<typeof createServer<T>>;

function createServer<T extends { id: string }>(options: { rows?: readonly T[] }) {
  const rows = new Map<string, T>((options.rows ?? (generateDemoRows(1000) as unknown as readonly T[])).map((row) => [row.id, row]));
  const filterable = options.rows ? new Set(Object.keys(options.rows[0] ?? {})) : DEMO_FILTERABLE_COLUMNS;
  let order = [...rows.keys()];

  const cell = (row: T, columnId: string): string => {
    const value = row[columnId as keyof T];
    return value == null ? "" : String(value);
  };

  const matchFilter = (row: T, filter: RemoteFilter): boolean => {
    const text = cell(row, filter.columnId);
    const num = Number(text);
    const v = filter.value;
    switch (filter.operator) {
      case "contains":
        return text.toLowerCase().includes(String(v).toLowerCase());
      case "notContains":
        return !text.toLowerCase().includes(String(v).toLowerCase());
      case "equals":
        return text === String(v);
      case "notEquals":
        return text !== String(v);
      case "startsWith":
        return text.startsWith(String(v));
      case "endsWith":
        return text.endsWith(String(v));
      case "empty":
        return text === "";
      case "notEmpty":
        return text !== "";
      case "gt":
        return !Number.isNaN(num) && num > Number(v);
      case "gte":
        return !Number.isNaN(num) && num >= Number(v);
      case "lt":
        return !Number.isNaN(num) && num < Number(v);
      case "lte":
        return !Number.isNaN(num) && num <= Number(v);
      case "isBetween": {
        const [min, max] = v as [string, string];
        if (!Number.isNaN(num)) return (min === "" || num >= Number(min)) && (max === "" || num <= Number(max));
        return (min === "" || text >= min) && (max === "" || text <= max);
      }
      case "isAnyOf":
        return (v as string[]).some((entry) => entry.toLowerCase() === text.toLowerCase());
      case "isNoneOf":
        return !(v as string[]).some((entry) => entry.toLowerCase() === text.toLowerCase());
      default:
        return true;
    }
  };

  async function select(query: Pick<RemoteQuery, "search" | "sorts" | "filters" | "signal">): Promise<T[]> {
    await delay(query.signal);
    let list = order.map((id) => rows.get(id)!);
    if (query.search) {
      const needle = query.search.toLowerCase();
      list = list.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(needle)));
    }
    const filters = query.filters ?? [];
    if (filters.length > 0) {
      assertFilterTree(filters, filterable);
      const matchNode = (row: T, node: RemoteFilterNode): boolean => {
        if (!isGroup(node)) return matchFilter(row, node);
        if (node.filters.length === 0) return true;
        const match = node.join === "or" ? node.filters.some((f) => matchNode(row, f)) : node.filters.every((f) => matchNode(row, f));
        return node.not === true ? !match : match;
      };
      list = list.filter((row) => filters.every((f) => matchNode(row, f)));
    }
    const sorts = query.sorts ?? [];
    if (sorts.length > 0) {
      list = [...list].sort((a, b) => {
        for (const s of sorts) {
          const av = a[s.columnId as keyof T];
          const bv = b[s.columnId as keyof T];
          const delta = typeof av === "number" && typeof bv === "number" ? av - bv : collator.compare(String(av), String(bv));
          if (delta !== 0) return s.direction === "asc" ? delta : -delta;
        }
        return 0;
      });
    }
    return list;
  }

  async function fetchPage(query: RemoteQuery): Promise<{ rows: T[]; total: number }> {
    const list = await select(query);
    const start = (query.page - 1) * query.pageSize;
    return { rows: list.slice(start, start + query.pageSize), total: list.length };
  }

  /** The rows `[start, end)` of the filtered, sorted list plus its total, for a lazy grid. */
  async function fetchRange(query: Omit<RemoteQuery, "page" | "pageSize"> & { start: number; end: number }): Promise<{ rows: T[]; total: number }> {
    const list = await select(query);
    return { rows: list.slice(query.start, query.end), total: list.length };
  }

  /** A keyset page: the rows after the opaque `after` cursor, and the cursor of the next page (`null` at the end). No count. */
  async function fetchAfter(query: Omit<RemoteQuery, "page" | "pageSize"> & { after?: string; limit: number }): Promise<{ rows: T[]; next: string | null }> {
    const list = await select(query);
    const last = query.after === undefined ? -1 : query.after.startsWith("after:") ? Number(query.after.slice("after:".length)) : Number.NaN;
    if (!Number.isSafeInteger(last) || last < -1) throw new Error("invalid cursor");
    const rows = list.slice(last + 1, last + 1 + query.limit);
    return { rows, next: last + 1 + rows.length < list.length ? `after:${last + rows.length}` : null };
  }

  /** The distinct values of a column with their row counts, filtered by a case-insensitive `search` and capped at `limit`. */
  async function fetchValues(query: { columnId: string; search: string; filters?: readonly RemoteFilterNode[]; limit?: number; signal?: AbortSignal }): Promise<{ values: { value: string; count: number }[] }> {
    if (!filterable.has(query.columnId)) throw new Error("invalid column");
    const list = await select({ filters: query.filters, signal: query.signal });
    const counts = new Map<string, number>();
    const needle = query.search.toLowerCase();
    for (const row of list) {
      const label = cell(row, query.columnId);
      if (needle === "" || label.toLowerCase().includes(needle)) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const values = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => collator.compare(a.value, b.value));
    return { values: values.slice(0, query.limit ?? 200) };
  }

  function applyOps(ops: DataChange<T>["ops"]): void {
    const next = applyChange(order.map((id) => rows.get(id)!), { ops, source: "app" }, (row) => row.id);
    rows.clear();
    for (const row of next) rows.set(row.id, row);
    order = next.map((row) => row.id);
  }

  /** Sets a new value on the server for the number column `columnId` of each known row and returns the matching pushes. */
  function bumpNumbers(ids: readonly string[], columnId: string, next: (value: number) => number): { rowId: string; changes: Record<string, number> }[] {
    const pushes: { rowId: string; changes: Record<string, number> }[] = [];
    for (const id of ids) {
      const row = rows.get(id);
      if (!row) continue;
      const value = next(Number(row[columnId as keyof T]));
      rows.set(id, { ...row, [columnId]: value });
      pushes.push({ rowId: id, changes: { [columnId]: value } });
    }
    return pushes;
  }

  /** Deletes rows on the server, as another client would. */
  function remove(ids: readonly string[]): void {
    for (const id of ids) rows.delete(id);
    order = order.filter((id) => rows.has(id));
  }

  return { total: rows.size, fetchPage, fetchRange, fetchAfter, fetchValues, applyOps, bumpNumbers, remove };
}
