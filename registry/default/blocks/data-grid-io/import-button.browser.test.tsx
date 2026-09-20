import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridImportButton } from "./data-grid-io";
// real stylesheet so Tailwind's `grid`/dialog utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; age: number | null };

function makeRows(): Row[] {
  return [{ id: "seed-0", name: "Seed", age: 1 }];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

function makeCsvFile(content: string): File {
  return new File([content], "people.csv", { type: "text/csv" });
}

describe("DataGridImportButton (browser)", () => {
  it("end-to-end: file -> preview -> confirm -> onImport rows correct", async () => {
    let imported: Row[] | null = null;
    let nextId = 0;

    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: `imported-${nextId++}`, name: "", age: null })}
          onImport={(rows: Row[]) => {
            imported = rows;
          }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    await expect.element(page.getByText("Import file")).toBeInTheDocument();

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = makeCsvFile("Name,Age\nAlice,30\nBob,40");
    await userEvent.upload(fileInput!, file);

    // preview table shows the parsed data rows.
    await expect.element(page.getByText("Alice")).toBeInTheDocument();
    await expect.element(page.getByText("Bob")).toBeInTheDocument();
    await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

    expect(imported).not.toBeNull();
    expect(imported).toEqual([
      { id: "imported-0", name: "Alice", age: 30 },
      { id: "imported-1", name: "Bob", age: 40 },
    ]);
  });

  it("skips a column mapped to '—' and clears an invalid number instead of dropping the row", async () => {
    let imported: Row[] | null = null;
    let nextId = 0;

    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: `imported-${nextId++}`, name: "", age: null })}
          onImport={(rows: Row[]) => {
            imported = rows;
          }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = makeCsvFile("Name,Age\nAlice,not-a-number");
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

    expect(imported).toEqual([{ id: "imported-0", name: "Alice", age: null }]);
  });

  it("with 40+ columns, the mapping grid scrolls horizontally without escaping the dialog, and selects stay aligned with their preview cells", async () => {
    const COLUMN_COUNT = 42;
    const wideColumns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
      { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
    ] as const);

    const headerNames = Array.from({ length: COLUMN_COUNT }, (_, i) => `Very Long Source Column Header ${i + 1}`);
    const csv = [headerNames.join(","), headerNames.map((_, i) => `value-${i}`).join(",")].join("\n");
    const file = makeCsvFile(csv);

    render(
      <DataGridProvider data={makeRows()} columns={wideColumns} getRowId={(r) => r.id}>
        <DataGridImportButton createRow={(): Row => ({ id: "imported-0", name: "", age: null })} onImport={() => {}} />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("value-0")).toBeInTheDocument();

    const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
    expect(dialog).not.toBeNull();
    const mappingGrid = document.querySelector<HTMLElement>('[role="table"]');
    expect(mappingGrid).not.toBeNull();
    const scrollContainer = mappingGrid!.parentElement as HTMLElement;

    // the scroll container clips a grid wider than itself instead of blowing out the dialog.
    expect(mappingGrid!.scrollWidth).toBeGreaterThan(scrollContainer.clientWidth);

    const dialogRect = dialog!.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    // the clipping container never exceeds the dialog's own right edge.
    expect(containerRect.right).toBeLessThanOrEqual(dialogRect.right + 1);
    expect(containerRect.left).toBeGreaterThanOrEqual(dialogRect.left - 1);

    // the scroll container clips overflow at its own edge — cells past it are legitimately scrolled
    // out of the visible area (that's what overflow-x-auto is for), so only the container's own
    // box (already checked above) needs to stay inside the dialog. Sanity-check the first (visible)
    // column's cells actually render inside the dialog, i.e. nothing is escaping the clip un-clipped.
    const firstColumnCells = [
      mappingGrid!.querySelector<HTMLElement>('[role="columnheader"]'),
      mappingGrid!.querySelector<HTMLElement>('[role="cell"]'),
    ];
    for (const cell of firstColumnCells) {
      expect(cell).not.toBeNull();
      const cellRect = cell!.getBoundingClientRect();
      expect(cellRect.right).toBeLessThanOrEqual(dialogRect.right + 1);
    }

    // a header cell (containing the select) and the preview cell directly below it share the same
    // grid column track (same left edge) — this is what keeps selects aligned with their preview data.
    const firstHeaderCell = mappingGrid!.querySelector<HTMLElement>('[role="columnheader"]');
    const firstSelectTrigger = firstHeaderCell!.querySelector<HTMLElement>("button");
    const firstPreviewCell = mappingGrid!.querySelector<HTMLElement>('[role="cell"]');
    expect(firstSelectTrigger).not.toBeNull();
    expect(firstPreviewCell).not.toBeNull();
    expect(Math.round(firstHeaderCell!.getBoundingClientRect().left)).toBe(
      Math.round(firstPreviewCell!.getBoundingClientRect().left),
    );
    // the select trigger (inset by the header cell's own padding) still starts left-of the next column.
    expect(firstSelectTrigger!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      firstHeaderCell!.getBoundingClientRect().left,
    );

    // footer stays inside the dialog.
    await expect.element(page.getByText(`Showing 1 of 1 rows`)).toBeInTheDocument();
  });

  it("disables a grid column in other selects once it's mapped from one source column", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton createRow={(): Row => ({ id: "imported-0", name: "", age: null })} onImport={() => {}} />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    // two source columns that don't auto-match, so both start on "— Skip —" and can be mapped by hand.
    const file = makeCsvFile("Full Name,Alt Name\nAlice,Alicia");
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    const triggers = document.querySelectorAll<HTMLElement>('[role="columnheader"] button');
    expect(triggers.length).toBe(2);

    // map the first source column ("Full Name") to the grid's "Name" column.
    await userEvent.click(triggers[0]!);
    await userEvent.click(page.getByRole("option", { name: "Name" }));

    // opening the second select, "Name" is now disabled — can't create a duplicate mapping.
    await userEvent.click(triggers[1]!);
    const nameOption = page.getByRole("option", { name: "Name" });
    await expect.element(nameOption).toBeInTheDocument();
    await expect.element(nameOption).toHaveAttribute("aria-disabled", "true");
  });

  it("quick-skip X button sets a mapped column back to Skip, and hides once already skipped", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton createRow={(): Row => ({ id: "imported-0", name: "", age: null })} onImport={() => {}} />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = makeCsvFile("Name,Age\nAlice,30");
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    // "Name" auto-matched, so its quick-skip X button is present.
    const quickSkipButtons = document.querySelectorAll<HTMLElement>('[aria-label="Skip column"]');
    expect(quickSkipButtons.length).toBe(2);

    await userEvent.click(quickSkipButtons[0]!);

    // the Select for the first column now shows the skip sentinel value.
    const firstTrigger = document.querySelectorAll<HTMLElement>('[role="columnheader"] button')[0]!;
    expect(firstTrigger.textContent).toContain("__skip__");

    // once skipped, its own quick-skip X button disappears (only the still-mapped "Age" column keeps one).
    expect(document.querySelectorAll('[aria-label="Skip column"]').length).toBe(1);
  });

  it("defaultDelimiter preselects the delimiter without waiting for auto-detect", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: "imported-0", name: "", age: null })}
          onImport={() => {}}
          importDefaults={{ defaultDelimiter: ";" }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    // comma-delimited content; defaultDelimiter still forces ';' as the parse delimiter.
    const file = makeCsvFile("Name;Age\nAlice;30");
    await userEvent.upload(fileInput!, file);

    const delimiterTrigger = page.getByRole("combobox", { name: "Delimiter" });
    await expect.element(delimiterTrigger).toHaveTextContent(";");
  });

  it("autoDetectDelimiter: false suppresses detection and uses defaultDelimiter (or comma)", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: "imported-0", name: "", age: null })}
          onImport={() => {}}
          importDefaults={{ autoDetectDelimiter: false }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    // semicolon-delimited content would normally auto-detect to ';'; forcing off detection parses
    // it as comma-delimited instead, so the whole line becomes one column.
    const file = makeCsvFile("Name;Age\nAlice;30");
    await userEvent.upload(fileInput!, file);

    const delimiterTrigger = page.getByRole("combobox", { name: "Delimiter" });
    await expect.element(delimiterTrigger).toHaveTextContent(",");
    await expect.element(page.getByText("Name;Age")).toBeInTheDocument();
  });

  it("defaultSkipColumns preselects Skip by header name (case-insensitive) and by index", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: "imported-0", name: "", age: null })}
          onImport={() => {}}
          importDefaults={{ defaultSkipColumns: ["age"] }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = makeCsvFile("Name,Age\nAlice,30");
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    // scope to the mapping grid's own [role="table"] — the real DataGridHeader behind the dialog
    // also renders [role="columnheader"] cells, so an unscoped query would double-count them.
    const mappingGrid = document.querySelector<HTMLElement>('[role="table"]')!;
    const headers = mappingGrid.querySelectorAll<HTMLElement>('[role="columnheader"]');
    // each columnheader's first button is its Select trigger; a mapped column also has a second
    // (quick-skip X) button, so query per-header rather than flattening all buttons across headers.
    const selectTriggers = Array.from(headers, (header) => header.querySelector<HTMLElement>("button")!);
    // "Name" (index 0) still auto-matches to the "name" grid column; "Age" (index 1, named in
    // defaultSkipColumns) is forced to the skip sentinel instead of auto-matching "age".
    expect(selectTriggers[0]!.textContent).toContain("name");
    expect(selectTriggers[1]!.textContent).toContain("__skip__");
  });

  it("mapColumn override wins over both the built-in matcher and defaultSkipColumns", async () => {
    let imported: Row[] | null = null;
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: "imported-0", name: "", age: null })}
          onImport={(rows: Row[]) => {
            imported = rows;
          }}
          importDefaults={{
            defaultSkipColumns: ["Name"],
            mapColumn: (header) => (header === "Full Name" ? "name" : undefined),
          }}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    // "Full Name" wouldn't auto-match "name" at all; mapColumn maps it anyway.
    const file = makeCsvFile("Full Name,Age\nAlice,30");
    await userEvent.upload(fileInput!, file);
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));
    expect(imported).toEqual([{ id: "imported-0", name: "Alice", age: 30 }]);
  });
});

/** Resolves after `ms`, so a test can observe the window where the import batch is held but not applied. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Async Standard Schema over the age column: rejects negatives, otherwise doubles. */
const asyncAgeSchema = {
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async (value: unknown) => {
      await delay(30);
      return typeof value === "number" && value < 0
        ? { issues: [{ message: "must be non-negative" }] }
        : { value: typeof value === "number" ? value * 2 : value };
    },
  },
};

const asyncColumns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, validate: asyncAgeSchema as never },
] as const);

describe("DataGridImportButton with an async schema (workplan #79)", () => {
  function renderImportGrid(onImport: (rows: Row[]) => void) {
    let nextId = 0;
    render(
      <DataGridProvider data={makeRows()} columns={asyncColumns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: `imported-${nextId++}`, name: "", age: null })}
          onImport={onImport}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
  }

  it("keeps the dialog open with Import disabled while validating, then imports the transformed rows", async () => {
    let imported: Row[] | null = null;
    renderImportGrid((rows) => {
      imported = rows;
    });

    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    await userEvent.upload(fileInput!, makeCsvFile("Name,Age\nAlice,30\nBob,-5"));
    await expect.element(page.getByText("Alice")).toBeInTheDocument();

    const confirm = page.getByRole("button", { name: "Import", exact: true });
    await userEvent.click(confirm);

    // held: the dialog stays open and its confirm button is disabled — the existing pending affordance
    await delay(5);
    expect(imported).toBeNull();
    await expect.element(confirm).toBeDisabled();

    await vi.waitFor(() => expect(imported).not.toBeNull());
    // Alice's 30 doubled; Bob's -5 rejected, so his age falls back to the cell type's clearValue()
    expect(imported).toEqual([
      { id: "imported-0", name: "Alice", age: 60 },
      { id: "imported-1", name: "Bob", age: null },
    ]);
  });
});

/** B6/G4: a multi-sheet workbook opens on its first sheet with a picker to switch, rather than a silent single choice. */
describe("multi-sheet workbook sheet picker (B6/G4)", () => {
  async function makeWorkbookFile(sheets: Record<string, string[][]>): Promise<File> {
    const XLSX = await import("xlsx");
    const book = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    }
    const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return new File([buffer], "book.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  async function openWith(file: File): Promise<void> {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridImportButton
          createRow={(): Row => ({ id: "imported", name: "", age: null })}
          onImport={() => {}}
        />
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    await userEvent.upload(fileInput!, file);
  }

  it("opens a multi-sheet workbook on its first sheet with a picker naming that sheet", async () => {
    await openWith(
      await makeWorkbookFile({
        Summary: [["Name", "Age"], ["Alice", "30"]],
        "Q3 Data": [["Name", "Age"], ["Bob", "40"]],
      }),
    );

    const sheetTrigger = page.getByRole("combobox", { name: "Sheet" });
    await expect.element(sheetTrigger).toHaveTextContent("Summary");
    // the rows really did come from sheet 1
    await expect.element(page.getByText("Alice")).toBeInTheDocument();
  });

  it("re-parses the workbook when another sheet is picked", async () => {
    await openWith(
      await makeWorkbookFile({
        Summary: [["Name", "Age"], ["Alice", "30"]],
        "Q3 Data": [["Name", "Age"], ["Bob", "40"]],
      }),
    );

    const sheetTrigger = page.getByRole("combobox", { name: "Sheet" });
    await userEvent.click(sheetTrigger);
    await userEvent.click(page.getByRole("option", { name: "Q3 Data" }));
    await expect.element(sheetTrigger).toHaveTextContent("Q3 Data");
    await expect.element(page.getByText("Bob")).toBeInTheDocument();
    await expect.element(page.getByText("Alice")).not.toBeInTheDocument();
  });

  it("stays silent for a single-sheet workbook", async () => {
    await openWith(await makeWorkbookFile({ Only: [["Name", "Age"], ["Alice", "30"]] }));

    await expect.element(page.getByText("Alice")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Sheet");
  });

  it("keeps the picker on the chosen sheet and disables Import when the sheet is empty", async () => {
    await openWith(
      await makeWorkbookFile({
        Summary: [["Name", "Age"], ["Alice", "30"]],
        "Q3 Data": [["Name", "Age"], ["Bob", "40"]],
        Empty: [],
      }),
    );

    const sheetTrigger = page.getByRole("combobox", { name: "Sheet" });
    await userEvent.click(sheetTrigger);
    await userEvent.click(page.getByRole("option", { name: "Empty" }));
    await expect.element(sheetTrigger).toHaveTextContent("Empty");
    await expect.element(page.getByText("No rows found in this file.")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  });
});
