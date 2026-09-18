import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { useDataGridUrlPagination } from "./use-data-grid-url-pagination";
import {
  useDataGridPagination,
  DataGridPaginationBar,
} from "@/registry/default/blocks/data-grid-pagination/data-grid-pagination";
// real stylesheet so Select/Button layout is real, matching other block browser tests
import "@/app/global.css";

const TOTAL_ROWS = 101;

function UrlPaginatedGrid() {
  const url = useDataGridUrlPagination();
  // the url hook owns page/pageSize; only `total` is the consumer's to supply.
  const pager = useDataGridPagination({ total: TOTAL_ROWS, ...url });
  return <DataGridPaginationBar {...pager.controls} />;
}

function renderGrid(options: { searchParams?: string; onUrlUpdate?: (event: UrlUpdateEvent) => void }) {
  return render(
    <NuqsTestingAdapter searchParams={options.searchParams} onUrlUpdate={options.onUrlUpdate} hasMemory>
      <UrlPaginatedGrid />
    </NuqsTestingAdapter>,
  );
}

describe("useDataGridUrlPagination + useDataGridPagination: composition", () => {
  it("deep-links to the page given by the URL", async () => {
    renderGrid({ searchParams: "?page=3" });
    await expect.element(page.getByText("51–75 of 101")).toBeInTheDocument();
  });

  it("an out-of-range page in the URL clamps to the last page", async () => {
    renderGrid({ searchParams: "?page=999" });
    await expect.element(page.getByText("101–101 of 101")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("clicking a page number updates the URL via replace", async () => {
    const onUrlUpdate = vi.fn();
    renderGrid({ onUrlUpdate });
    await page.getByRole("button", { name: "Go to page 3" }).click();
    await expect.element(page.getByText("51–75 of 101")).toBeInTheDocument();
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBe("3");
      expect(last?.options.history).toBe("replace");
    });
  });

  it("changing the page-size select updates the URL and omits the page param", async () => {
    const onUrlUpdate = vi.fn();
    renderGrid({ searchParams: "?page=3", onUrlUpdate });
    await page.getByRole("combobox", { name: "Rows per page" }).click();
    await page.getByRole("option", { name: "50 / page" }).click();
    await expect.element(page.getByText("1–50 of 101")).toBeInTheDocument();
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("pageSize")).toBe("50");
      expect(last?.searchParams.get("page")).toBeNull();
    });
  });

  it("omits page and pageSize from the URL when both are at their defaults", async () => {
    const onUrlUpdate = vi.fn();
    renderGrid({ searchParams: "?page=2", onUrlUpdate });
    await page.getByRole("button", { name: "First page" }).click();
    await expect.element(page.getByText("1–25 of 101")).toBeInTheDocument();
    await vi.waitFor(() => {
      const last = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent | undefined;
      expect(last?.searchParams.get("page")).toBeNull();
      expect(last?.searchParams.get("pageSize")).toBeNull();
    });
  });
});
