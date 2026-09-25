import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { useDataGridUrlPagination, type UseDataGridUrlPaginationOptions, type UseDataGridUrlPaginationResult } from "./use-data-grid-url-pagination";

afterEach(cleanup);

/** Exposes the hook's return value to the test via a callback, since it can only be called inside a component. */
function HookProbe(props: { options?: UseDataGridUrlPaginationOptions; onResult: (result: UseDataGridUrlPaginationResult) => void }) {
  const result = useDataGridUrlPagination(props.options);
  props.onResult(result);
  return null;
}

function renderHook(options: {
  searchParams?: string;
  hookOptions?: UseDataGridUrlPaginationOptions;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
}) {
  let latest: UseDataGridUrlPaginationResult | undefined;
  const utils = render(
    <NuqsTestingAdapter searchParams={options.searchParams} onUrlUpdate={options.onUrlUpdate}>
      <HookProbe options={options.hookOptions} onResult={(r) => (latest = r)} />
    </NuqsTestingAdapter>,
  );
  return { ...utils, getResult: () => latest! };
}

describe("useDataGridUrlPagination: reading from the URL", () => {
  it("defaults to page 1 and the default pageSize when no params are present", () => {
    const { getResult } = renderHook({});
    expect(getResult().page).toBe(1);
    expect(getResult().pageSize).toBe(25);
  });

  it("opens on the page given by a deep-linked URL", () => {
    const { getResult } = renderHook({ searchParams: "?page=3" });
    expect(getResult().page).toBe(3);
  });

  it("reads a non-default pageSize from the URL", () => {
    const { getResult } = renderHook({ searchParams: "?pageSize=50" });
    expect(getResult().pageSize).toBe(50);
  });

  it("clamps a negative/fractional page from the URL to 1", () => {
    expect(renderHook({ searchParams: "?page=-5" }).getResult().page).toBe(1);
    cleanup();
    expect(renderHook({ searchParams: "?page=2.5" }).getResult().page).toBe(1);
  });

  it("clamps a pageSize outside pageSizeOptions back to the default", () => {
    const { getResult } = renderHook({ searchParams: "?pageSize=999", hookOptions: { pageSizeOptions: [10, 25, 50] } });
    expect(getResult().pageSize).toBe(25);
  });

  it("namespaces URL keys with the prefix option", () => {
    const { getResult } = renderHook({ hookOptions: { prefix: "orders" }, searchParams: "?page=2&orders_page=5" });
    expect(getResult().page).toBe(5);
  });

  it("honors a custom defaultPageSize", () => {
    const { getResult } = renderHook({ hookOptions: { defaultPageSize: 100 } });
    expect(getResult().pageSize).toBe(100);
  });

  it("exposes the resolved pageSizeOptions so the bar's select matches the URL allow-list", () => {
    expect(renderHook({}).getResult().pageSizeOptions).toEqual([10, 25, 50, 100]);
    cleanup();
    expect(renderHook({ hookOptions: { pageSizeOptions: [5, 15] } }).getResult().pageSizeOptions).toEqual([5, 15]);
  });

  it("clamps an out-of-range deep-linked page to the last page when total is given", () => {
    // 100 rows, pageSize 25 → last page 4
    expect(renderHook({ searchParams: "?page=999", hookOptions: { total: 100 } }).getResult().page).toBe(4);
    cleanup();
    expect(renderHook({ searchParams: "?page=0", hookOptions: { total: 100 } }).getResult().page).toBe(1);
    cleanup();
    // valid deep-link is untouched
    expect(renderHook({ searchParams: "?page=2", hookOptions: { total: 100 } }).getResult().page).toBe(2);
    cleanup();
    // without total the raw (in-range or not) value passes through, as before
    expect(renderHook({ searchParams: "?page=999" }).getResult().page).toBe(999);
  });

  it("writes the clamped page back to the URL on mount when total is given", async () => {
    const onUrlUpdate = vi.fn();
    renderHook({ searchParams: "?page=999", hookOptions: { total: 100 }, onUrlUpdate });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBe("4");
    });
  });

  it("rewrites the URL page once total becomes available after mounting without it", async () => {
    const onUrlUpdate = vi.fn();
    let latest: UseDataGridUrlPaginationResult | undefined;
    const { rerender } = render(
      <NuqsTestingAdapter searchParams="?page=999" onUrlUpdate={onUrlUpdate}>
        <HookProbe onResult={(r) => (latest = r)} />
      </NuqsTestingAdapter>,
    );

    // total still undefined: nothing normalized yet, and the raw out-of-range page passes through.
    await act(async () => {});
    expect(latest!.page).toBe(999);
    expect(onUrlUpdate.mock.calls.filter((c) => (c[0] as UrlUpdateEvent).searchParams.has("page"))).toEqual([]);

    rerender(
      <NuqsTestingAdapter searchParams="?page=999" onUrlUpdate={onUrlUpdate}>
        <HookProbe options={{ total: 100 }} onResult={(r) => (latest = r)} />
      </NuqsTestingAdapter>,
    );

    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBe("4");
    });
  });

  it("does not touch the URL on mount when the deep-linked page is already in range", async () => {
    const onUrlUpdate = vi.fn();
    renderHook({ searchParams: "?page=2", hookOptions: { total: 100 }, onUrlUpdate });
    await act(async () => {});
    expect(onUrlUpdate.mock.calls.filter((c) => (c[0] as UrlUpdateEvent).searchParams.has("page"))).toEqual([]);
  });
});

describe("useDataGridUrlPagination: writing to the URL", () => {
  it("onPageChange updates the URL via replace", async () => {
    const onUrlUpdate = vi.fn();
    const { getResult } = renderHook({ onUrlUpdate });
    await act(async () => {
      getResult().onPageChange(3);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBe("3");
      expect(last?.options.history).toBe("replace");
    });
  });

  it("onPageChange back to page 1 omits the param entirely", async () => {
    const onUrlUpdate = vi.fn();
    const { getResult } = renderHook({ searchParams: "?page=3", onUrlUpdate });
    await act(async () => {
      getResult().onPageChange(1);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBeNull();
    });
  });

  it("onPageSizeChange updates the URL and resets the page param", async () => {
    const onUrlUpdate = vi.fn();
    const { getResult } = renderHook({ searchParams: "?page=3", onUrlUpdate });
    await act(async () => {
      getResult().onPageSizeChange(50);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("pageSize")).toBe("50");
      expect(last?.searchParams.get("page")).toBeNull();
    });
  });

  it("onPageSizeChange back to the default pageSize omits the param entirely", async () => {
    const onUrlUpdate = vi.fn();
    const { getResult } = renderHook({ searchParams: "?pageSize=50", onUrlUpdate });
    await act(async () => {
      getResult().onPageSizeChange(25);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("pageSize")).toBeNull();
    });
  });

  it("namespaces written URL keys with the prefix option", async () => {
    const onUrlUpdate = vi.fn();
    const { getResult } = renderHook({ hookOptions: { prefix: "orders" }, onUrlUpdate });
    await act(async () => {
      getResult().onPageChange(2);
    });
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("orders_page")).toBe("2");
      expect(last?.searchParams.get("page")).toBeNull();
    });
  });
});

describe("useDataGridUrlPagination: identity stability", () => {
  it("keeps the same onPageChange/onPageSizeChange references across re-renders with the same options", () => {
    const seen: UseDataGridUrlPaginationResult[] = [];
    const { rerender } = render(
      <NuqsTestingAdapter>
        <HookProbe onResult={(r) => seen.push(r)} />
      </NuqsTestingAdapter>,
    );
    rerender(
      <NuqsTestingAdapter>
        <HookProbe onResult={(r) => seen.push(r)} />
      </NuqsTestingAdapter>,
    );
    expect(seen[0]?.onPageChange).toBe(seen[1]?.onPageChange);
    expect(seen[0]?.onPageSizeChange).toBe(seen[1]?.onPageSizeChange);
  });
});
