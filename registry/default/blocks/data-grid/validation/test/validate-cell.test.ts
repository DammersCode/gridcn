import { describe, expect, it, vi } from "vitest";
import { formatIssues, isStandardSchema, runValidatePending, runValidateSync } from "../validate-cell";
import type { StandardSchemaV1 } from "../../types";

/** Minimal mock StandardSchemaV1 — no library import anywhere in repo code (per spec). */
function mockSchema<TValue>(
  validate: (value: unknown) => StandardSchemaV1<TValue, TValue>["~standard"]["validate"] extends (v: unknown) => infer R ? R : never,
): StandardSchemaV1<TValue, TValue> {
  return { "~standard": { version: 1, vendor: "mock", validate } };
}

describe("isStandardSchema", () => {
  it("detects an object with a '~standard' key", () => {
    const schema = mockSchema((v) => ({ value: v }));
    expect(isStandardSchema(schema)).toBe(true);
  });

  it("rejects the function form", () => {
    expect(isStandardSchema((value: unknown) => (value ? null : "required"))).toBe(false);
  });

  it("rejects null/undefined/primitives", () => {
    expect(isStandardSchema(null)).toBe(false);
    expect(isStandardSchema(undefined)).toBe(false);
    expect(isStandardSchema("a string")).toBe(false);
    expect(isStandardSchema(42)).toBe(false);
  });
});

describe("formatIssues", () => {
  it("uses the first issue's message when there's exactly one", () => {
    expect(formatIssues([{ message: "must be positive" }])).toBe("must be positive");
  });

  it("joins multiple issues with '; '", () => {
    expect(formatIssues([{ message: "too short" }, { message: "must be numeric" }])).toBe("too short; must be numeric");
  });

  it("prefixes a plain PropertyKey path as a dot-joined string", () => {
    expect(formatIssues([{ message: "required", path: ["age"] }])).toBe("age: required");
  });

  it("prefixes a multi-segment path, unwrapping { key } segments", () => {
    expect(formatIssues([{ message: "required", path: ["address", { key: "zip" }] }])).toBe("address.zip: required");
  });

  it("omits the prefix when path is absent", () => {
    expect(formatIssues([{ message: "no path here" }])).toBe("no path here");
  });
});

describe("runValidateSync", () => {
  it("returns { value } when validate is undefined", () => {
    expect(runValidateSync(undefined, 42, {})).toEqual({ value: 42 });
  });

  describe("function form (unchanged)", () => {
    it("passes through null as acceptance", () => {
      const validate = (value: unknown) => (typeof value === "number" && value >= 0 ? null : "must be >= 0");
      expect(runValidateSync(validate, 5, {})).toEqual({ value: 5 });
    });

    it("returns { error } for a rejection message", () => {
      const validate = (value: unknown) => (typeof value === "number" && value >= 0 ? null : "must be >= 0");
      expect(runValidateSync(validate, -1, {})).toEqual({ error: "must be >= 0" });
    });

    it("receives (value, row) exactly as the direct call would", () => {
      const validate = vi.fn(() => null);
      const row = { id: "r1" };
      runValidateSync(validate, "v", row);
      expect(validate).toHaveBeenCalledWith("v", row);
    });
  });

  describe("sync Standard Schema", () => {
    it("passing: returns { value: result.value }", () => {
      const schema = mockSchema<number>((v) => ({ value: (v as number) * 2 }));
      expect(runValidateSync(schema, 5, {})).toEqual({ value: 10 });
    });

    it("failing: returns { error } from the first issue", () => {
      const schema = mockSchema<number>(() => ({ issues: [{ message: "must be positive" }] }));
      expect(runValidateSync(schema, -1, {})).toEqual({ error: "must be positive" });
    });

    it("transform: committed value is result.value, not the raw input", () => {
      const schema = mockSchema<string>((v) => ({ value: String(v).trim().toLowerCase() }));
      const result = runValidateSync(schema, "  HELLO  ", {});
      expect(result).toEqual({ value: "hello" });
      expect(result).not.toEqual({ value: "  HELLO  " });
    });
  });

  describe("async Standard Schema on the sync-only path", () => {
    it("passes the value through UNCHANGED — the caller above awaits, this one cannot", () => {
      const schema = mockSchema<number>(() => Promise.resolve({ value: 999 }) as never);
      expect(runValidateSync(schema, 5, {})).toEqual({ value: 5 });
    });

    it("no longer warns: async on a bulk path is supported (workplan #79)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const schema = mockSchema<number>(() => Promise.resolve({ value: 1 }) as never);
      runValidateSync(schema, 1, {});
      runValidateSync(schema, 2, {});
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});

describe("runValidatePending", () => {
  it("returns a ValidateResult for the sync forms", () => {
    expect(runValidatePending(undefined, 1, {})).toEqual({ value: 1 });
    expect(runValidatePending(() => "bad", 1, {})).toEqual({ error: "bad" });
    expect(runValidatePending(mockSchema<number>((v) => ({ value: v as number })), 1, {})).toEqual({ value: 1 });
  });

  it("returns the schema's own Promise when it is async — no wrapper allocated", async () => {
    const promise = Promise.resolve({ value: 42 });
    const schema = mockSchema<number>(() => promise as never);
    const pending = runValidatePending(schema, 1, {});
    expect(pending).toBe(promise);
    await promise;
  });
});
