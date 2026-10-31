import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { useCommitGuard } from "./use-commit-guard";

describe("useCommitGuard", () => {
  it("lets the first commit through and blocks the next ones (Enter then blur)", () => {
    const { result } = renderHook(() => useCommitGuard());
    expect(result.current.tryCommit()).toBe(true);
    expect(result.current.tryCommit()).toBe(false);
    expect(result.current.tryCommit()).toBe(false);
  });

  it("reset re-arms it, for a retry after an async rejection", () => {
    const { result } = renderHook(() => useCommitGuard());
    result.current.tryCommit();
    result.current.reset();
    expect(result.current.tryCommit()).toBe(true);
  });

  it("keeps the fired state across renders", () => {
    const { result, rerender } = renderHook(() => useCommitGuard());
    result.current.tryCommit();
    rerender();
    expect(result.current.tryCommit()).toBe(false);
  });

  it("commits once under StrictMode double render", () => {
    const { result } = renderHook(() => useCommitGuard(), { wrapper: StrictMode });
    expect(result.current.tryCommit()).toBe(true);
    expect(result.current.tryCommit()).toBe(false);
  });
});
