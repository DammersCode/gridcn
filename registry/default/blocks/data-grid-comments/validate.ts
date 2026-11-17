import { toSafeText } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { AckOutcome } from "./comment-state";
import type { CellComment, CommentAuthor, CommentChange } from "./types";

const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 80;
const MAX_COLOR_LENGTH = 64;
export const MAX_VERSION = 1_000_000_000;
const MAX_EPOCH_MS = 8.64e15;

export type Bounds = {
  maxTextLength: number;
  maxCommentsPerCell: number;
  maxComments: number;
  maxCachedRows: number;
};

export const DEFAULT_BOUNDS: Bounds = { maxTextLength: 2000, maxCommentsPerCell: 50, maxComments: 50_000, maxCachedRows: 2000 };
const BOUND_CEILINGS: Bounds = { maxTextLength: 20_000, maxCommentsPerCell: 500, maxComments: 500_000, maxCachedRows: 20_000 };

function bound(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, ceiling);
}

/** NaN, zero, negative, and fractional values fall back to the default; large values clamp to the ceiling. */
export function resolveBounds(options: Partial<Bounds>): Bounds {
  return {
    maxTextLength: bound(options.maxTextLength, DEFAULT_BOUNDS.maxTextLength, BOUND_CEILINGS.maxTextLength),
    maxCommentsPerCell: bound(options.maxCommentsPerCell, DEFAULT_BOUNDS.maxCommentsPerCell, BOUND_CEILINGS.maxCommentsPerCell),
    maxComments: bound(options.maxComments, DEFAULT_BOUNDS.maxComments, BOUND_CEILINGS.maxComments),
    maxCachedRows: bound(options.maxCachedRows, DEFAULT_BOUNDS.maxCachedRows, BOUND_CEILINGS.maxCachedRows),
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BIDI_OVERRIDE_G = /[\u202a-\u202e\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI_G = /[\u0000-\u001f\u007f-\u009f‎‏\u202a-\u202e\u061c\u2066-\u2069]/g;

type Raw = {
  id?: unknown; name?: unknown; color?: unknown; rowId?: unknown; columnId?: unknown; text?: unknown; createdAt?: unknown;
  updatedAt?: unknown; version?: unknown; resolved?: unknown; author?: unknown; writeId?: unknown; resolvedBy?: unknown;
  resolvedAt?: unknown; kind?: unknown; baseVersion?: unknown; comment?: unknown;
};

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !CONTROL.test(value);
}

/** Strips control and bidi-override characters and bounds the length. */
export function sanitizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.slice(0, MAX_NAME_LENGTH * 2).replace(CONTROL_OR_BIDI_G, "").trim().slice(0, MAX_NAME_LENGTH);
  return clean === "" ? undefined : clean;
}

/** Validates an author into a fresh frozen object, or `null`. */
export function validateAuthor(value: unknown): CommentAuthor | null {
  try {
    return readAuthor(value);
  } catch {
    return null;
  }
}

function readAuthor(value: unknown): CommentAuthor | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Raw;
  const id = raw.id;
  const rawName = raw.name;
  const color = raw.color;
  if (!isSafeId(id)) return null;
  const author: CommentAuthor = { id };
  const name = sanitizeName(rawName);
  if (name !== undefined) author.name = name;
  if (typeof color === "string" && color.length > 0 && color.length <= MAX_COLOR_LENGTH && !CONTROL.test(color)) author.color = color;
  return Object.freeze(author);
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Math.abs(value) <= MAX_EPOCH_MS;
}

export function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_VERSION;
}

/** `toSafeText` minus bidi overrides, plus trim: the text a write stores. The caller checks the bounds on the result. */
export function cleanText(value: unknown): string {
  return toSafeText(value).replace(BIDI_OVERRIDE_G, "").trim();
}

/** Validates one record into a fresh frozen object (each field read once), or `null`. Text over `maxTextLength` is a breach, never truncated. */
export function validateComment(value: unknown, bounds: Bounds): CellComment | null {
  try {
    return readComment(value, bounds);
  } catch {
    return null;
  }
}

function readComment(value: unknown, bounds: Bounds): CellComment | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Raw;
  const id = raw.id;
  const rowId = raw.rowId;
  const columnId = raw.columnId;
  const rawText = raw.text;
  const createdAt = raw.createdAt;
  const updatedAt = raw.updatedAt;
  const version = raw.version;
  const resolved = raw.resolved;
  const rawAuthor = raw.author;
  const writeId = raw.writeId;
  const rawResolvedBy = raw.resolvedBy;
  const resolvedAt = raw.resolvedAt;
  if (!isSafeId(id) || !isSafeId(rowId) || !isSafeId(columnId)) return null;
  if (typeof rawText !== "string" || rawText.length > bounds.maxTextLength * 4) return null;
  const text = rawText.replace(BIDI_OVERRIDE_G, "").trim();
  if (text.length < 1 || text.length > bounds.maxTextLength) return null;
  if (!isEpoch(createdAt) || !isEpoch(updatedAt) || !isVersion(version) || typeof resolved !== "boolean") return null;
  const record: CellComment = { id, rowId, columnId, text, createdAt, updatedAt, version, resolved };
  if (rawAuthor !== undefined) {
    const author = validateAuthor(rawAuthor);
    if (!author) return null;
    record.author = author;
  }
  if (writeId !== undefined) {
    if (!isSafeId(writeId)) return null;
    record.writeId = writeId;
  }
  if (rawResolvedBy !== undefined) {
    const resolvedBy = validateAuthor(rawResolvedBy);
    if (!resolvedBy) return null;
    record.resolvedBy = resolvedBy;
  }
  if (resolvedAt !== undefined) {
    if (!isEpoch(resolvedAt)) return null;
    record.resolvedAt = resolvedAt;
  }
  return Object.freeze(record);
}

/** Validates a change (an upsert with a record, or a delete tombstone) into a fresh frozen object, or `null`. */
export function validateChange(value: unknown, bounds: Bounds): CommentChange | null {
  try {
    return readChange(value, bounds);
  } catch {
    return null;
  }
}

function readChange(value: unknown, bounds: Bounds): CommentChange | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Raw;
  const kind = raw.kind;
  const baseVersion = raw.baseVersion;
  if (baseVersion !== undefined && !(typeof baseVersion === "number" && Number.isInteger(baseVersion) && baseVersion >= 0 && baseVersion <= MAX_VERSION)) return null;
  if (kind === "upsert") {
    const comment = validateComment(raw.comment, bounds);
    if (!comment) return null;
    return Object.freeze(baseVersion === undefined ? { kind: "upsert" as const, comment } : { kind: "upsert" as const, comment, baseVersion });
  }
  if (kind === "delete") {
    const id = raw.id;
    const rowId = raw.rowId;
    const columnId = raw.columnId;
    const version = raw.version;
    const writeId = raw.writeId;
    if (!isSafeId(id) || !isSafeId(rowId) || !isSafeId(columnId) || !isVersion(version)) return null;
    if (writeId !== undefined && !isSafeId(writeId)) return null;
    const change: CommentChange = { kind: "delete", id, rowId, columnId, version };
    if (writeId !== undefined) change.writeId = writeId;
    if (baseVersion !== undefined) change.baseVersion = baseVersion;
    return Object.freeze(change);
  }
  return null;
}

/** Reads an `onCommentSave` answer: unknown shapes accept the write as sent, records pass `validateComment`. */
export function parseSaveAnswer(raw: unknown, bounds: Bounds): AckOutcome {
  if (raw === undefined || raw === null) return { kind: "void", server: true };
  if (typeof raw !== "object") return { kind: "void", server: true };
  const record = raw as { comment?: unknown; rejected?: { reason?: unknown; message?: unknown; current?: unknown } };
  if (record.rejected && typeof record.rejected === "object") {
    const { reason, message, current } = record.rejected;
    const allowed = reason === "stale" || reason === "forbidden" || reason === "invalid" || reason === "limit";
    const out: Extract<AckOutcome, { kind: "rejected" }> = { kind: "rejected", reason: allowed ? reason : "invalid" };
    if (typeof message === "string") out.message = message.slice(0, 200);
    if (current === null) out.current = null;
    else if (current !== undefined) {
      const valid = validateComment(current, bounds);
      if (valid) out.current = valid;
    }
    return out;
  }
  if ("comment" in record) {
    if (record.comment === null) return { kind: "record", comment: null };
    if (record.comment === undefined) return { kind: "void", server: true };
    const valid = validateComment(record.comment, bounds);
    return valid ? { kind: "record", comment: valid } : { kind: "invalid" };
  }
  return { kind: "void", server: true };
}
