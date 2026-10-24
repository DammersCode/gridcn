import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  useDataGridActions,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridUrlState } from "./data-grid-url-state";
import "@/app/global.css";

type Row = { id: string; name: string; age: number; city: string };

const rows: Row[] = [{ id: "r0", name: "Alice", age: 30, city: "Berlin" }];

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 90 },
] as const);

let actions!: ReturnType<typeof useDataGridActions>;
let urlState!: ReturnType<typeof useDataGridUrlState>;

function Probe() {
  actions = useDataGridActions();
  urlState = useDataGridUrlState({ layout: ["order", "hidden", "widths", "pins"] });
  return null;
}

let urlSearch = "";
let setUrlSearch!: (search: string) => void;

function Harness({ initial }: { initial: string }) {
  const [search, setSearch] = useState(initial);
  urlSearch = search;
  setUrlSearch = setSearch;
  return (
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={(event) => setSearch(event.queryString)} hasMemory>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
        <Probe />
        <DataGridRoot className="h-[200px] w-[600px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </NuqsTestingAdapter>
  );
}

const headerIds = () => [...document.querySelectorAll('[role="columnheader"]')].map((h) => h.getAttribute("data-column-id"));
const headerWidth = (id: string) => document.querySelector(`[role="columnheader"][data-column-id="${id}"]`)!.getBoundingClientRect().width;
const query = () => new URLSearchParams(urlSearch);

describe("column layout round trip through the URL", () => {
  it("writes order, hidden, width, and pin to the address bar", async () => {
    await render(<Harness initial="" />);
    actions.setColumnOrder("city", "name", "before");
    actions.setColumnHidden("age", true);
    actions.commitColumnWidth("name", 150);
    actions.setColumnPin("city", "left");
    await expect.poll(() => query().get("hide")).toBe("age");
    await expect.poll(() => query().get("widths")).toBe("name:150");
    await expect.poll(() => query().get("pins")).toContain("city");
    expect(query().get("cols")).toContain("city");
  });

  it("restores the layout from a URL on load", async () => {
    await render(<Harness initial="?cols=city,name,age&hide=age&widths=name:150" />);
    await expect.poll(() => headerIds()).toEqual(["city", "name"]);
    await expect.poll(() => Math.round(headerWidth("name"))).toBe(150);
  });

  it("applyFromUrl follows a URL change made outside the grid", async () => {
    await render(<Harness initial="?hide=age" />);
    await expect.poll(() => headerIds()).toEqual(["name", "city"]);
    setUrlSearch("?cols=city,name,age");
    await new Promise((resolve) => setTimeout(resolve, 50));
    urlState.applyFromUrl();
    await expect.poll(() => headerIds()).toEqual(["city", "name", "age"]);
  });
});
