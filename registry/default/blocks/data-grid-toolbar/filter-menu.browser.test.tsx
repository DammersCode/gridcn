import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridFilterMenu } from "./filter-menu";
import "@/app/global.css";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", filter: { operators: [{ id: "inRegion", label: "In region" }, "contains"] } },
];

afterEach(() => {
  document.body.innerHTML = "";
});

async function newRowOperatorText(filterMode: "client" | "server") {
  await render(
    <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id} filterMode={filterMode}>
      <DataGridFilterMenu />
    </DataGridProvider>,
  );
  await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
  const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add filter"));
  await userEvent.click(add!);
  return document.querySelector<HTMLElement>('[data-grid-filter-row] [aria-label*="perator" i]')?.textContent ?? "";
}

describe("DataGridFilterMenu custom operators", () => {
  it("starts a new row on an operator that can narrow rows under client filtering", async () => {
    expect(await newRowOperatorText("client")).not.toContain("In region");
  });

  it("starts a new row on the first declared custom operator under server filtering", async () => {
    expect(await newRowOperatorText("server")).toContain("In region");
  });
});
