import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { ImportColumnMapping, ImportRejectedCell } from "./build-imported-rows";

/** Longest refusal message the import check keeps. */
export const MAX_CHECK_MESSAGE_LENGTH = 200;

/** Refusals the import check reads; the rest count as "and more". */
export const MAX_CHECK_REFUSALS = 1_000;

/** One row the server refuses. `rowIndex` is the 0-based index into the rows `checkImport` received. */
export type ImportCheckRefusal = { rowIndex: number; columnId?: string; message?: string };

/** Counts a server reports for the rows it checked. */
export type ImportCheckSummary = { created?: number; updated?: number; skipped?: number };

/** What `checkImport` returns. An answer without refusals lets the import go on. */
export type ImportCheckAnswer = { rejected?: ImportCheckRefusal[]; summary?: ImportCheckSummary };

/** What `checkImport` receives besides the rows. */
export type ImportCheckContext = {
  /** Aborts when the user cancels, the dialog closes, or a new file loads. Pass it to your request. */
  signal: AbortSignal;
  /** Which file column went to which grid column. */
  mapping: readonly ImportColumnMapping[];
  fileName: string;
  /** The sheet the rows came from; undefined for CSV. */
  sheetName?: string;
  /** Cells whose value failed `column.validate`; each was cleared and its row is in the rows. */
  rejected: readonly ImportRejectedCell[];
};

/** Checks the built rows before they are saved; see {@link ImportCheckAnswer}. */
export type CheckImport<TData> = (rows: TData[], ctx: ImportCheckContext) => ImportCheckAnswer | void | Promise<ImportCheckAnswer | void>;

/** The read answer: `failed` for a shape the check does not accept, else the bounded refusals. */
export type ImportCheck = { status: "failed" } | { status: "checked"; refusals: ImportCheckRefusal[]; more: number; summary?: ImportCheckSummary };

const FAILED: ImportCheck = { status: "failed" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function readSummary(value: unknown): ImportCheckSummary | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const summary: ImportCheckSummary = {};
  for (const key of ["created", "updated", "skipped"] as const) {
    const count = value[key];
    if (count === undefined) continue;
    if (!isCount(count)) return null;
    summary[key] = count;
  }
  return summary;
}

function readRefusal(entry: unknown, rowCount: number, columnIds: ReadonlySet<string>): ImportCheckRefusal | null {
  if (!isRecord(entry)) return null;
  const rowIndex = entry["rowIndex"], columnId = entry["columnId"], message = entry["message"];
  if (typeof rowIndex !== "number" || !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount) return null;
  if (columnId !== undefined && typeof columnId !== "string") return null;
  if (message !== undefined && typeof message !== "string") return null;
  const refusal: ImportCheckRefusal = { rowIndex };
  if (columnId !== undefined && columnIds.has(columnId)) refusal.columnId = columnId;
  if (message !== undefined) refusal.message = message.slice(0, MAX_CHECK_MESSAGE_LENGTH);
  return refusal;
}

/**
 * Reads an untrusted `checkImport` answer: at most {@link MAX_CHECK_REFUSALS} refusals, each `rowIndex`
 * inside `rowCount`, `columnId` kept only for a live column, `message` cut. Any other shape is `failed`.
 */
export function readImportCheckAnswer(answer: unknown, rowCount: number, columnIds: ReadonlySet<string>): ImportCheck {
  try {
    if (answer === undefined || answer === null) return { status: "checked", refusals: [], more: 0 };
    if (!isRecord(answer)) return FAILED;
    const summary = readSummary(answer["summary"]);
    if (summary === null) return FAILED;
    const rejected = answer["rejected"];
    if (rejected !== undefined && !Array.isArray(rejected)) return FAILED;
    const refusals: ImportCheckRefusal[] = [];
    const read = Math.min(rejected?.length ?? 0, MAX_CHECK_REFUSALS);
    for (let i = 0; i < read; i++) {
      const refusal = readRefusal(rejected![i], rowCount, columnIds);
      if (!refusal) return FAILED;
      refusals.push(refusal);
    }
    return { status: "checked", refusals, more: Math.max((rejected?.length ?? 0) - read, 0), ...(summary && { summary }) };
  } catch {
    return FAILED;
  }
}

/** Runs `checkImport` over built rows and reads the answer. A throw or a rejection is `failed`, except an abort, which rethrows. */
export async function runImportCheck<TData>(checkImport: CheckImport<TData>, rows: TData[], ctx: ImportCheckContext, columnIds: ReadonlySet<string>): Promise<ImportCheck> {
  try {
    return readImportCheckAnswer(await checkImport(rows, ctx), rows.length, columnIds);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    if (isDev()) console.warn("[data-grid-io] checkImport failed", error);
    return FAILED;
  }
}
