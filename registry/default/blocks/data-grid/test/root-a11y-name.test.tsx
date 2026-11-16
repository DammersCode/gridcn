import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGrid, type ColumnDefOf } from "../data-grid";

const columns: ColumnDefOf<{ id: string; name: string }>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data = [{ id: "r1", name: "A" }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const nameWarnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter((call) => String(call[0]).includes("accessible name"));

describe("grid accessible name", () => {
  it("warns once without an accessible name, and not with aria-label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} />);
    view.rerender(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} />);
    expect(nameWarnings(warn)).toHaveLength(1);
    warn.mockClear();
    cleanup();
    render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-label="People" />);
    expect(nameWarnings(warn)).toHaveLength(0);
  });

  it("does not warn with aria-labelledby", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<DataGrid data={data} columns={columns} getRowId={(r) => r.id} aria-labelledby="title" />);
    expect(nameWarnings(warn)).toHaveLength(0);
  });

  it("warns inside a labelled ancestor, because a grid takes no name from an ancestor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <section aria-label="People">
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id} />
      </section>,
    );
    expect(nameWarnings(warn)).toHaveLength(1);
  });
});
