import { applyChange, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { generateDemoRows, type DemoRow } from "./demo-data";

export type RemoteSort = { columnId: string; direction: "asc" | "desc" };
export type RemoteFilter = { columnId: string; operator: string; value?: string | [string, string] | string[] };
export type RemoteFilterGroup = { join: "and" | "or"; filters: readonly RemoteFilterNode[] };
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
const FILTERABLE_COLUMNS: ReadonlySet<string> = new Set(["id", "name", "email", "age", "active", "role", "joined", "score"]);

const isGroup = (node: RemoteFilterNode): node is RemoteFilterGroup => "filters" in node;

/** Checks an untrusted filter tree before it is evaluated: depth, leaf count, and join values. */
function assertFilterTree(nodes: readonly RemoteFilterNode[], allowed: ReadonlySet<string>): void {
  let leaves = 0;
  const walk = (list: readonly RemoteFilterNode[], depth: number) => {
    if (!Array.isArray(list)) throw new Error("invalid filter tree");
    for (const node of list as readonly RemoteFilterNode[]) {
      if (isGroup(node)) {
        if (depth >= MAX_FILTER_DEPTH || (node.join !== "and" && node.join !== "or")) throw new Error("invalid filter group");
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
 * so edits survive a refetch.
 */
export function createRemoteServer() {
  const rows = new Map<string, DemoRow>(generateDemoRows(1000).map((row) => [row.id, row]));
  let order = [...rows.keys()];

  const cell = (row: DemoRow, columnId: string): string => {
    const value = row[columnId as keyof DemoRow];
    return value == null ? "" : String(value);
  };

  const matchFilter = (row: DemoRow, filter: RemoteFilter): boolean => {
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

  async function fetchPage(query: RemoteQuery): Promise<{ rows: DemoRow[]; total: number }> {
    await delay(query.signal);
    let list = order.map((id) => rows.get(id)!);
    if (query.search) {
      const needle = query.search.toLowerCase();
      list = list.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(needle)));
    }
    const filters = query.filters ?? [];
    if (filters.length > 0) {
      assertFilterTree(filters, FILTERABLE_COLUMNS);
      const matchNode = (row: DemoRow, node: RemoteFilterNode): boolean => {
        if (!isGroup(node)) return matchFilter(row, node);
        return node.join === "or" ? node.filters.some((f) => matchNode(row, f)) : node.filters.every((f) => matchNode(row, f));
      };
      list = list.filter((row) => filters.every((f) => matchNode(row, f)));
    }
    const sorts = query.sorts ?? [];
    if (sorts.length > 0) {
      list = [...list].sort((a, b) => {
        for (const s of sorts) {
          const av = a[s.columnId as keyof DemoRow];
          const bv = b[s.columnId as keyof DemoRow];
          const delta = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          if (delta !== 0) return s.direction === "asc" ? delta : -delta;
        }
        return 0;
      });
    }
    const total = list.length;
    const start = (query.page - 1) * query.pageSize;
    return { rows: list.slice(start, start + query.pageSize), total };
  }

  function applyOps(ops: DataChange<DemoRow>["ops"]): void {
    const next = applyChange(order.map((id) => rows.get(id)!), { ops, source: "app" }, (row) => row.id);
    rows.clear();
    for (const row of next) rows.set(row.id, row);
    order = next.map((row) => row.id);
  }

  return { total: rows.size, fetchPage, applyOps };
}
