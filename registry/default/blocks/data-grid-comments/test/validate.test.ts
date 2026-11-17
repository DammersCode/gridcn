// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defaultCreateId, createWriteIdGenerator } from "../create-id";
import { DEFAULT_COMMENTS_LABELS } from "../labels";
import { DEFAULT_BOUNDS, resolveBounds, sanitizeName, validateAuthor, validateChange, validateComment } from "../validate";

const bounds = DEFAULT_BOUNDS;
const base = { id: "c1", rowId: "r1", columnId: "name", text: "hello", author: { id: "u1" }, createdAt: 1, updatedAt: 1, version: 1, resolved: false };

describe("resolveBounds", () => {
  it("falls back to the default for NaN, zero, negative, and fractional values and clamps to the ceiling", () => {
    expect(resolveBounds({ maxTextLength: Number.NaN, maxCommentsPerCell: 0, maxComments: -4, maxCachedRows: 1.5 })).toEqual(DEFAULT_BOUNDS);
    expect(resolveBounds({ maxTextLength: 10_000_000, maxCommentsPerCell: 9999, maxComments: 9_999_999, maxCachedRows: 999_999 })).toEqual({
      maxTextLength: 20_000,
      maxCommentsPerCell: 500,
      maxComments: 500_000,
      maxCachedRows: 20_000,
    });
    expect(resolveBounds({ maxTextLength: 10 }).maxTextLength).toBe(10);
  });
});

describe("validateComment", () => {
  it("returns a fresh frozen record and never keeps unknown fields", () => {
    const input = { ...base, extra: "x" };
    const valid = validateComment(input, bounds);
    expect(valid).not.toBeNull();
    expect(valid).not.toBe(input);
    expect(Object.isFrozen(valid)).toBe(true);
    expect(valid && "extra" in valid).toBe(false);
  });

  it("rejects a bad id, a control character, text over the bound, a bad version, and non-finite times", () => {
    expect(validateComment({ ...base, id: "" }, bounds)).toBeNull();
    expect(validateComment({ ...base, id: "x".repeat(129) }, bounds)).toBeNull();
    expect(validateComment({ ...base, rowId: "a\nb" }, bounds)).toBeNull();
    expect(validateComment({ ...base, text: "x".repeat(2001) }, bounds)).toBeNull();
    expect(validateComment({ ...base, text: "x".repeat(8001) }, bounds)).toBeNull();
    expect(validateComment({ ...base, text: "   " }, bounds)).toBeNull();
    expect(validateComment({ ...base, version: 0 }, bounds)).toBeNull();
    expect(validateComment({ ...base, version: 1.5 }, bounds)).toBeNull();
    expect(validateComment({ ...base, version: 1_000_000_001 }, bounds)).toBeNull();
    expect(validateComment({ ...base, createdAt: Number.POSITIVE_INFINITY }, bounds)).toBeNull();
    expect(validateComment({ ...base, resolved: "no" }, bounds)).toBeNull();
    expect(validateComment(Object.create(null), bounds)).toBeNull();
    expect(validateComment(null, bounds)).toBeNull();
    expect(validateComment("str", bounds)).toBeNull();
  });

  it("trims text and keeps markup as plain text", () => {
    expect(validateComment({ ...base, text: "  <script>alert(1)</script> " }, bounds)?.text).toBe("<script>alert(1)</script>");
  });

  it("reads a getter-backed field once", () => {
    let reads = 0;
    const tricky = { ...base, get text() { reads += 1; return reads === 1 ? "ok" : "x".repeat(99_999); } };
    expect(validateComment(tricky, bounds)?.text).toBe("ok");
    expect(reads).toBe(1);
  });
});

describe("validateAuthor and sanitizeName", () => {
  it("strips control and bidi-override characters and bounds the name", () => {
    expect(sanitizeName("A\u202eb\u0000c\u2066")).toBe("Abc");
    expect(sanitizeName("x".repeat(500))?.length).toBe(80);
    expect(sanitizeName("\u202e\u202d")).toBeUndefined();
    expect(sanitizeName(42)).toBeUndefined();
  });

  it("accepts a CSS color string and drops an over-long or control-laden one", () => {
    expect(validateAuthor({ id: "u", color: "oklch(0.7 0.1 60)" })?.color).toBe("oklch(0.7 0.1 60)");
    expect(validateAuthor({ id: "u", color: "x".repeat(65) })?.color).toBeUndefined();
    expect(validateAuthor({ id: "u", color: "red\u0000" })?.color).toBeUndefined();
    expect(validateAuthor({ id: "" })).toBeNull();
  });
});

describe("validateChange", () => {
  it("validates upserts and deletes and rejects unknown kinds and bad baseVersions", () => {
    expect(validateChange({ kind: "upsert", comment: base, baseVersion: 0 }, bounds)).toMatchObject({ kind: "upsert", baseVersion: 0 });
    expect(validateChange({ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 2, writeId: "w" }, bounds)).toMatchObject({ kind: "delete", writeId: "w" });
    expect(validateChange({ kind: "move" }, bounds)).toBeNull();
    expect(validateChange({ kind: "upsert", comment: base, baseVersion: -1 }, bounds)).toBeNull();
    expect(validateChange({ kind: "delete", id: "c1", rowId: "r1", columnId: "name", version: 0 }, bounds)).toBeNull();
  });
});

describe("ids and labels", () => {
  it("creates distinct ids, and write ids with a per-instance prefix", () => {
    expect(defaultCreateId()).not.toBe(defaultCreateId());
    const next = createWriteIdGenerator();
    const other = createWriteIdGenerator();
    expect(next()).not.toBe(next());
    expect(next().split("-")[0]).toBe(next().split("-")[0]);
    expect(next().split("-")[0]).not.toBe(other().split("-")[0]);
  });

  it("falls back when crypto.randomUUID is missing", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(defaultCreateId()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("builds plural-aware announcements", () => {
    expect(DEFAULT_COMMENTS_LABELS.announce(1, 1, "Shift+F2")).toContain("1 comment,");
    expect(DEFAULT_COMMENTS_LABELS.announce(3, 2, "Shift+F2")).toContain("3 comments,");
  });
});
