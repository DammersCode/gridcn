import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { render } from "vitest-browser-react";
import DataGridValidationDemo from "../../../examples/data-grid-validation-demo";
import { DataGrid, defineColumns } from "../data-grid";
import { GRID_ATTR } from "../data-grid-sdk";
import "@/app/global.css";

afterEach(() => {
  toast.dismiss();
});

const EDITING = `[role="gridcell"][${GRID_ATTR.editing}="true"]`;

function cell(column: string, row = 0): HTMLElement {
  return document.querySelectorAll<HTMLElement>(`[role="gridcell"][data-column-id="${column}"]`)[row]!;
}

function alertElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alert"]');
}

/** True when the element's center, clipped to every scrolling or clipping ancestor, is the topmost thing painted there. */
function paintsOnTop(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  let { left, top, right, bottom } = rect;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const box = parent.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  if (right <= left || bottom <= top) return false;
  const whole = Math.abs(left - rect.left) < 1 && Math.abs(right - rect.right) < 1 && Math.abs(top - rect.top) < 1 && Math.abs(bottom - rect.bottom) < 1;
  if (!whole) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return hit !== null && el.contains(hit);
}

async function pointerAway(): Promise<void> {
  await userEvent.hover(document.body);
  await vi.waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull(), { timeout: 2000 });
}

async function typeIntoCell(column: string, text: string, row = 0): Promise<void> {
  await userEvent.dblClick(cell(column, row));
  const input = document.querySelector<HTMLInputElement>(`${EDITING} input`)!;
  await userEvent.clear(input);
  await userEvent.type(input, text);
}

const HARD_COLUMNS = [
  { column: "age", invalid: "12", message: "Must be 18 or older", original: "28" },
  { column: "email", invalid: "nope", message: "Must contain @", original: "ada@example.com" },
  { column: "sku", invalid: "SKU-001", message: "Already in use", original: "SKU-101" },
  { column: "price", invalid: "abc", message: "Must be a number", original: "42" },
  { column: "score", invalid: "150", message: "Too big: expected number to be <=100", original: "87" },
  { column: "code", invalid: "lower", message: "Use uppercase letters, digits, or dashes", original: "ADA-1843" },
  { column: "tag", invalid: "ab", message: "Invalid length: Expected >=3 but received 2", original: "math" },
] as const;

describe("data-grid-validation-demo: hard rules", () => {
  for (const { column, invalid, message, original } of HARD_COLUMNS) {
    it(`${column}: Enter keeps the editor open with an inline message and a title; Escape restores the old value`, async () => {
      await render(<DataGridValidationDemo />);
      await typeIntoCell(column, invalid);
      await userEvent.keyboard("{Enter}");

      await vi.waitFor(() => expect(alertElement()?.textContent).toBe(message), { timeout: 3000 });
      expect(cell(column)).toHaveAttribute(GRID_ATTR.editing, "true");
      await pointerAway();
      expect(paintsOnTop(alertElement()!)).toBe(true);

      expect(cell(column)).toHaveAttribute("title", message);

      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() => expect(document.querySelector(EDITING)).toBeNull());
      expect(cell(column).textContent).toBe(original);
      expect(cell(column)).not.toHaveAttribute("aria-invalid");
      expect(alertElement()).toBeNull();
    });
  }

  it("Tab and a click on another cell keep the editor open on a rejected value", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("age", "12");
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() => expect(alertElement()?.textContent).toBe("Must be 18 or older"));
    expect(cell("age")).toHaveAttribute(GRID_ATTR.editing, "true");

    await userEvent.click(cell("name", 3));
    expect(cell("age")).toHaveAttribute(GRID_ATTR.editing, "true");
    expect(alertElement()?.textContent).toBe("Must be 18 or older");
  });

  it("the inline message paints on top in the last row and the last column", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("tag", "ab", 7);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(alertElement()).not.toBeNull());
    await pointerAway();
    expect(paintsOnTop(alertElement()!)).toBe(true);
  });

  it("the inline message of a narrow column paints on top of the next row", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("age", "12", 0);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(alertElement()).not.toBeNull());
    await pointerAway();
    const alertRect = alertElement()!.getBoundingClientRect();
    expect(alertRect.width).toBeGreaterThan(cell("age").getBoundingClientRect().width);
    expect(alertElement()!.scrollWidth).toBeLessThanOrEqual(alertElement()!.clientWidth);
    expect(paintsOnTop(alertElement()!)).toBe(true);
  });
});

describe("data-grid-validation-demo: Price coerces", () => {
  it("a decimal commits as the rounded integer", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("price", "42.9");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(cell("price").textContent).toBe("43"));
    expect(document.querySelector(EDITING)).toBeNull();
  });
});

describe("data-grid-validation-demo: async SKU", () => {
  it("the input is read-only while the check runs and the inline message appears afterwards", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("sku", "SKU-002");
    await userEvent.keyboard("{Enter}");
    expect(document.querySelector<HTMLInputElement>(`${EDITING} input`)!.readOnly).toBe(true);
    expect(alertElement()).toBeNull();
    await vi.waitFor(() => expect(alertElement()?.textContent).toBe("Already in use"), { timeout: 3000 });
  });
});

describe("data-grid-validation-demo: soft Notes", () => {
  it("a flagged cell shows its message inline while it is edited again, and a valid commit clears it", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("notes", "this is way too long text");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(cell("notes")).toHaveAttribute("aria-invalid", "true"));
    expect(cell("notes")).not.toHaveAttribute("title");
    expect(alertElement()).toBeNull();

    await userEvent.dblClick(cell("notes"));
    await vi.waitFor(() => expect(alertElement()?.textContent).toBe("Max 12 characters"));
    await pointerAway();
    expect(paintsOnTop(alertElement()!)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector(EDITING)).toBeNull());
    expect(cell("notes").textContent).toBe("this is way too long text");
    expect(cell("notes")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("inline message in pinned columns", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, a: i, b: i, c: i }));
  const reject = (value: unknown) => (typeof value === "number" && value > 10 ? "Too large" : null);
  const columns = defineColumns<(typeof rows)[number]>()([
    { id: "a", header: "A", accessorKey: "a", type: "number", pin: "start", width: 60, validate: reject },
    { id: "b", header: "B", accessorKey: "b", type: "number", width: 200 },
    { id: "c", header: "C", accessorKey: "c", type: "number", pin: "end", width: 60, validate: reject },
  ] as const);

  for (const column of ["a", "c"]) {
    it(`a ${column === "a" ? "start" : "end"}-pinned cell paints its inline message on top`, async () => {
      await render(
        <div style={{ height: 240, width: 360 }}>
          <DataGrid data={rows} columns={columns} getRowId={(row) => row.id} />
        </div>,
      );
      await typeIntoCell(column, "99", 1);
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => expect(alertElement()?.textContent).toBe("Too large"));
      await pointerAway();
      expect(paintsOnTop(alertElement()!)).toBe(true);
    });
  }
});

describe("the reason is available on hover while editing (native title)", () => {
  it("hovering an editing cell with a rejected value carries the message as title and keeps the same editor node", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("age", "12");
    const input = document.querySelector<HTMLInputElement>(`${EDITING} input`)!;
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(alertElement()?.textContent).toBe("Must be 18 or older"));
    expect(document.querySelector(`${EDITING} input`)).toBe(input);
    expect(document.activeElement).toBe(input);

    await userEvent.hover(cell("age"));
    expect(cell("age")).toHaveAttribute("title", "Must be 18 or older");
    expect(alertElement()?.textContent).toBe("Must be 18 or older");
    expect(cell("age")).toHaveAttribute("aria-invalid", "true");
    expect(cell("age")).toHaveAttribute("aria-description", "Must be 18 or older");
    expect(document.querySelector(`${EDITING} input`)).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("the typed text survives a rejection that lands while the pointer rests on the cell", async () => {
    await render(<DataGridValidationDemo />);
    await userEvent.dblClick(cell("email"));
    await userEvent.hover(cell("email"));
    const input = document.querySelector<HTMLInputElement>(`${EDITING} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "nope");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(cell("email")).toHaveAttribute("title", "Must contain @"));
    expect(document.querySelector<HTMLInputElement>(`${EDITING} input`)).toBe(input);
    expect(input.value).toBe("nope");
  });

  it("an async rejection puts the message in the title after the pending state", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("sku", "SKU-001");
    await userEvent.keyboard("{Enter}");
    await userEvent.hover(cell("sku"));
    await vi.waitFor(() => expect(cell("sku")).toHaveAttribute("title", "Already in use"), { timeout: 3000 });
  });

  it("a soft flag carries its message as title when the cell is edited again", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("notes", "this is way too long text");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(cell("notes")).toHaveAttribute("aria-invalid", "true"));
    await userEvent.dblClick(cell("notes"));
    await userEvent.hover(cell("notes"));
    expect(cell("notes")).toHaveAttribute("title", "Max 12 characters");
  });

  it("the editor keeps keyboard focus and Escape still cancels after hovering", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("age", "12");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(alertElement()).not.toBeNull());
    await userEvent.hover(cell("age"));
    expect(cell("age")).toHaveAttribute("title");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.querySelector(EDITING)).toBeNull());
    expect(cell("age").textContent).toBe("28");
    await vi.waitFor(() => expect(document.activeElement).toBe(cell("age")));
  });

  it("an editing cell in the last row carries the title", async () => {
    await render(<DataGridValidationDemo />);
    await typeIntoCell("tag", "ab", 7);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(alertElement()).not.toBeNull());
    await userEvent.hover(cell("tag", 7));
    expect(cell("tag", 7)).toHaveAttribute("title", "Invalid length: Expected >=3 but received 2");
  });
});
