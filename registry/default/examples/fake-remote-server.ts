import { generateDemoRows, type DemoRow } from "./demo-data";

export type RemoteSort = { columnId: string; direction: "asc" | "desc" };
export type RemoteFilter = { columnId: string; operator: string; value?: string | [string, string] | string[] };
export type RemoteQuery = {
  page: number;
  pageSize: number;
  search?: string;
  sorts?: readonly RemoteSort[];
  filters?: readonly RemoteFilter[];
  join?: "and" | "or";
  signal?: AbortSignal;
};

const LATENCY_MS = 300;

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
 * `applyOps` writes the grid's committed ops back into the store (a stand-in for your API route),
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
        return (v as string[]).includes(text);
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
      list = list.filter((row) =>
        (query.join ?? "and") === "or"
          ? filters.some((f) => matchFilter(row, f))
          : filters.every((f) => matchFilter(row, f)),
      );
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

  function applyOps(ops: readonly { type: string; rowId: string; row: DemoRow; index?: number; to?: number }[]): void {
    for (const op of ops) {
      if (op.type === "delete") {
        rows.delete(op.rowId);
        order = order.filter((id) => id !== op.rowId);
      } else {
        rows.set(op.rowId, op.row);
        if (op.type === "insert") order.splice(Math.min(op.index ?? order.length, order.length), 0, op.rowId);
        if (op.type === "move") {
          order = order.filter((id) => id !== op.rowId);
          order.splice(Math.min(op.to ?? 0, order.length), 0, op.rowId);
        }
      }
    }
  }

  return { total: rows.size, fetchPage, applyOps };
}
