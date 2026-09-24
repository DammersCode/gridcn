import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { DataGridProvider } from "../store";
import userEvent from "@testing-library/user-event";
import {
  cellTypes,
  textCellType,
  numberCellType,
  checkboxCellType,
  selectCellType,
  dateCellType,
} from "./cell-types";
import type { ColumnDef } from "../types";

afterEach(cleanup);

/** A minimal column def for a given value type; editors under test don't read any other field. */
function noopColumnOf<TValue>(): ColumnDef<unknown, TValue> {
  return { id: "col", header: "Col" };
}

function selectColumn(): ColumnDef<unknown, string | null> {
  return {
    id: "col",
    header: "Col",
    type: "select",
    options: {
      choices: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
    },
  };
}

describe("cellTypes registry", () => {
  it("exports all five built-in keys", () => {
    expect(Object.keys(cellTypes).sort()).toEqual(["checkbox", "date", "number", "select", "text"]);
  });
});

describe("textCellType value pipeline", () => {
  it("toText/fromText are identity", () => {
    expect(textCellType.toText("hello")).toBe("hello");
    expect(textCellType.fromText("hello")).toBe("hello");
  });

  it("fromText never throws, including empty string", () => {
    expect(textCellType.fromText("")).toBe("");
  });

  it("isEmpty treats null/undefined/empty string as empty", () => {
    expect(textCellType.isEmpty("")).toBe(true);
    expect(textCellType.isEmpty(null as unknown as string)).toBe(true);
    expect(textCellType.isEmpty(undefined as unknown as string)).toBe(true);
    expect(textCellType.isEmpty("x")).toBe(false);
  });

  it("clearValue returns empty string", () => {
    expect(textCellType.clearValue()).toBe("");
  });

  it("compare is localeCompare-based", () => {
    expect(textCellType.compare!("a", "b")).toBeLessThan(0);
    expect(textCellType.compare!("b", "a")).toBeGreaterThan(0);
    expect(textCellType.compare!("a", "a")).toBe(0);
  });
});

describe("numberCellType value pipeline", () => {
  it("fromText parses plain integers and decimals", () => {
    expect(numberCellType.fromText("42")).toBe(42);
    expect(numberCellType.fromText("3.14")).toBeCloseTo(3.14);
  });

  it("fromText normalizes comma decimal separators", () => {
    expect(numberCellType.fromText("3,14")).toBeCloseTo(3.14);
  });

  it("fromText trims whitespace", () => {
    expect(numberCellType.fromText("  7  ")).toBe(7);
  });

  it("fromText never throws on garbage; returns clearValue()'s result (null)", () => {
    expect(numberCellType.fromText("not a number")).toBeNull();
    expect(numberCellType.fromText("abc123")).toBeNull();
    expect(numberCellType.fromText("")).toBeNull();
  });

  it("fromText clamps to options min/max", () => {
    expect(numberCellType.fromText("100", { min: 0, max: 10 })).toBe(10);
    expect(numberCellType.fromText("-5", { min: 0, max: 10 })).toBe(0);
    expect(numberCellType.fromText("5", { min: 0, max: 10 })).toBe(5);
  });

  it("toText uses plain String(), no locale formatting", () => {
    expect(numberCellType.toText(1000)).toBe("1000");
    expect(numberCellType.toText(3.5)).toBe("3.5");
    expect(numberCellType.toText(null)).toBe("");
  });

  it("fromText rounds to options.decimals", () => {
    expect(numberCellType.fromText("3.14159", { decimals: 2 })).toBeCloseTo(3.14);
    expect(numberCellType.fromText("3.14159", { decimals: 0 })).toBe(3);
  });

  it("toText rounds to options.decimals", () => {
    expect(numberCellType.toText(3.14159, { decimals: 2 })).toBe("3.14");
    expect(numberCellType.toText(3.14159, { decimals: 0 })).toBe("3");
  });

  it("isEmpty is null-only (0 is not empty)", () => {
    expect(numberCellType.isEmpty(null)).toBe(true);
    expect(numberCellType.isEmpty(0)).toBe(false);
  });

  it("clearValue returns null", () => {
    expect(numberCellType.clearValue()).toBeNull();
  });

  it("compare is numeric with nulls sorted first", () => {
    expect(numberCellType.compare!(1, 2)).toBeLessThan(0);
    expect(numberCellType.compare!(2, 1)).toBeGreaterThan(0);
    expect(numberCellType.compare!(1, 1)).toBe(0);
    expect(numberCellType.compare!(null, 1)).toBeLessThan(0);
    expect(numberCellType.compare!(1, null)).toBeGreaterThan(0);
    expect(numberCellType.compare!(null, null)).toBe(0);
  });
});

describe("checkboxCellType value pipeline", () => {
  it("fromText accepts the truthy token set case-insensitively", () => {
    for (const token of ["true", "1", "yes", "x", "on", "TRUE", "Yes", "X"]) {
      expect(checkboxCellType.fromText(token)).toBe(true);
    }
  });

  it("fromText treats anything else as false, never throws", () => {
    expect(checkboxCellType.fromText("false")).toBe(false);
    expect(checkboxCellType.fromText("no")).toBe(false);
    expect(checkboxCellType.fromText("garbage")).toBe(false);
    expect(checkboxCellType.fromText("")).toBe(false);
  });

  it("toText serializes as 'true'/'false'", () => {
    expect(checkboxCellType.toText(true)).toBe("true");
    expect(checkboxCellType.toText(false)).toBe("false");
  });

  it("isEmpty is null-only (false is not empty)", () => {
    expect(checkboxCellType.isEmpty(null as unknown as boolean)).toBe(true);
    expect(checkboxCellType.isEmpty(false)).toBe(false);
  });

  it("clearValue returns false", () => {
    expect(checkboxCellType.clearValue()).toBe(false);
  });

  it("compare orders false before true", () => {
    expect(checkboxCellType.compare!(false, true)).toBeLessThan(0);
    expect(checkboxCellType.compare!(true, false)).toBeGreaterThan(0);
    expect(checkboxCellType.compare!(true, true)).toBe(0);
  });
});

const selectOptions = {
  choices: [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
  ],
};

describe("selectCellType value pipeline", () => {
  it("fromText matches by option value first", () => {
    expect(selectCellType.fromText("a", selectOptions)).toBe("a");
  });

  it("fromText matches by label case-insensitively when value doesn't match (pasted labels)", () => {
    expect(selectCellType.fromText("Alpha", selectOptions)).toBe("a");
    expect(selectCellType.fromText("alpha", selectOptions)).toBe("a");
    expect(selectCellType.fromText("BETA", selectOptions)).toBe("b");
  });

  it("fromText returns null for unknown text, never throws", () => {
    expect(selectCellType.fromText("nope", selectOptions)).toBeNull();
    expect(selectCellType.fromText("", selectOptions)).toBeNull();
    expect(selectCellType.fromText("anything")).toBeNull();
  });

  it("toText renders the option's label", () => {
    expect(selectCellType.toText("a", selectOptions)).toBe("Alpha");
    expect(selectCellType.toText("b", selectOptions)).toBe("Beta");
  });

  it("toText falls back to the raw value for an unknown/missing option", () => {
    expect(selectCellType.toText("zzz", selectOptions)).toBe("zzz");
  });

  it("toText returns '' for null", () => {
    expect(selectCellType.toText(null, selectOptions)).toBe("");
  });

  it("isEmpty is null-only", () => {
    expect(selectCellType.isEmpty(null)).toBe(true);
    expect(selectCellType.isEmpty("a")).toBe(false);
  });

  it("clearValue returns null", () => {
    expect(selectCellType.clearValue()).toBeNull();
  });

  it("compare is localeCompare on the raw value, nulls first", () => {
    expect(selectCellType.compare!("a", "b")).toBeLessThan(0);
    expect(selectCellType.compare!(null, "a")).toBeLessThan(0);
    expect(selectCellType.compare!("a", null)).toBeGreaterThan(0);
    expect(selectCellType.compare!(null, null)).toBe(0);
  });
});

describe("dateCellType value pipeline", () => {
  it("fromText accepts ISO yyyy-mm-dd unchanged", () => {
    expect(dateCellType.fromText("2026-07-03")).toBe("2026-07-03");
  });

  it("fromText normalizes Date.parse-able input to the ISO date part", () => {
    expect(dateCellType.fromText("2026-07-03T10:00:00Z")).toBe("2026-07-03");
    expect(dateCellType.fromText("July 3, 2026")).toBe("2026-07-03");
  });

  it("fromText returns null for unparseable/empty input, never throws", () => {
    expect(dateCellType.fromText("not a date")).toBeNull();
    expect(dateCellType.fromText("")).toBeNull();
    expect(dateCellType.fromText("   ")).toBeNull();
  });

  it("fromText rejects dates outside options.min/max", () => {
    const options = { min: "2026-01-01", max: "2026-12-31" };
    expect(dateCellType.fromText("2025-12-31", options)).toBeNull();
    expect(dateCellType.fromText("2027-01-01", options)).toBeNull();
    expect(dateCellType.fromText("2026-06-15", options)).toBe("2026-06-15");
  });

  it("toText returns the ISO string as-is, '' for null", () => {
    expect(dateCellType.toText("2026-07-03")).toBe("2026-07-03");
    expect(dateCellType.toText(null)).toBe("");
  });

  it("isEmpty is null-only", () => {
    expect(dateCellType.isEmpty(null)).toBe(true);
    expect(dateCellType.isEmpty("2026-07-03")).toBe(false);
  });

  it("clearValue returns null", () => {
    expect(dateCellType.clearValue()).toBeNull();
  });

  it("compare is lexicographic (ISO-safe) with nulls first", () => {
    expect(dateCellType.compare!("2026-01-01", "2026-12-31")).toBeLessThan(0);
    expect(dateCellType.compare!("2026-12-31", "2026-01-01")).toBeGreaterThan(0);
    expect(dateCellType.compare!("2026-01-01", "2026-01-01")).toBe(0);
    expect(dateCellType.compare!(null, "2026-01-01")).toBeLessThan(0);
    expect(dateCellType.compare!("2026-01-01", null)).toBeGreaterThan(0);
  });
});

/** Builds a fresh onChange/commit/cancel spy set for editor lifecycle tests. */
function editorSpies() {
  return { onChange: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
}

describe("textCellType.Editor lifecycle", () => {
  it("seeds from toText(value) when no initialText, with caret at the end — never select-all (diceui caret policy)", async () => {
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("hello");
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("seeds from initialText (type-to-replace) with cursor at the end", () => {
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        initialText="x"
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("x");
  });

  it("Enter parses, calls onChange, then commits with a down movement", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        initialText=""
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "world");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("world");
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 1 });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape cancels without calling onChange", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        initialText=""
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "world");
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("blur commits the current parse with no movement", () => {
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        initialText=""
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("changed");
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 0 });
  });

  it("blur after an Enter commit does not commit a second time", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <textCellType.Editor
        value="hello"
        initialText=""
        row={{}}
        column={noopColumnOf<string>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "world");
    await user.keyboard("{Enter}");
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("numberCellType.Editor lifecycle", () => {
  it("seeds the draft from toText(value, options), matching what the cell displays", () => {
    const { onChange, commit, cancel } = editorSpies();
    const column = { ...noopColumnOf<number | null>(), options: { decimals: 2 } };
    render(
      <numberCellType.Editor
        value={1.2345}
        row={{}}
        column={column}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("1.23");
  });

  it("Enter parses comma decimals, clamps via options, and commits down", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    const column = { ...noopColumnOf<number | null>(), options: { min: 0, max: 10 } };
    render(
      <numberCellType.Editor
        value={null}
        initialText=""
        row={{}}
        column={column}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "100");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(10);
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 1 });
  });

  it("Escape cancels without calling onChange", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <numberCellType.Editor
        value={null}
        initialText=""
        row={{}}
        column={noopColumnOf<number | null>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("garbage input commits null (clearValue), never throws", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <numberCellType.Editor
        value={null}
        initialText=""
        row={{}}
        column={noopColumnOf<number | null>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "garbage");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("blur after an Enter commit does not commit a second time", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <numberCellType.Editor
        value={null}
        initialText=""
        row={{}}
        column={noopColumnOf<number | null>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Enter}");
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

/** The date editor reads labels from the grid store, so its lifecycle tests mount a minimal provider. */
function DateEditorProvider({ children }: { children: ReactNode }) {
  return (
    <DataGridProvider
      data={[{ id: "1", when: null }]}
      columns={[{ id: "when", header: "When", accessorKey: "when", type: "date" }]}
      getRowId={(r) => r.id}
    >
      {children}
    </DataGridProvider>
  );
}

describe("dateCellType.Editor lifecycle", () => {
  it("opens a popover with a typed-input and a calendar", async () => {
    const { onChange, commit, cancel } = editorSpies();
    render(
      <DateEditorProvider>
        <dateCellType.Editor
          value={null}
          row={{}}
          column={noopColumnOf<string | null>()}
          onChange={onChange}
          commit={commit}
          cancel={cancel}
        />
      </DateEditorProvider>,
    );
    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    expect(await screen.findByRole("grid")).toBeInTheDocument(); // Calendar's month grid
  });

  it("Enter in the typed-input normalizes to ISO date and commits with no movement (commit-and-stay)", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <DateEditorProvider>
        <dateCellType.Editor
          value={null}
          row={{}}
          column={noopColumnOf<string | null>()}
          onChange={onChange}
          commit={commit}
          cancel={cancel}
        />
      </DateEditorProvider>,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "2026-07-03");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("2026-07-03");
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 1 });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape cancels without calling onChange", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <DateEditorProvider>
        <dateCellType.Editor
          value={null}
          row={{}}
          column={noopColumnOf<string | null>()}
          onChange={onChange}
          commit={commit}
          cancel={cancel}
        />
      </DateEditorProvider>,
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "2026-07-03");
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("picking a day in the calendar commits the ISO date with no movement (commit-and-stay)", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <DateEditorProvider>
        <dateCellType.Editor
          value="2026-07-03"
          row={{}}
          column={noopColumnOf<string | null>()}
          onChange={onChange}
          commit={commit}
          cancel={cancel}
        />
      </DateEditorProvider>,
    );
    const day = await screen.findByRole("button", { name: /15/ });
    await user.click(day);
    expect(onChange).toHaveBeenCalledWith("2026-07-15");
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 0 });
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe("checkboxCellType.Editor lifecycle", () => {
  // checkbox has no edit mode (diceui-editing-spec.md item 6): the interaction layer toggles
  // and commits directly via commitCellValue, never calling startEditing. This editor only
  // guards a stray startEditing call by bailing out (cancel) without writing anything.
  it("renders nothing and cancels immediately without calling onChange/commit", () => {
    const { onChange, commit, cancel } = editorSpies();
    const { container } = render(
      <checkboxCellType.Editor
        value={false}
        row={{}}
        column={noopColumnOf<boolean>()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("under StrictMode's mount->cleanup->mount double-invoke, cancel still fires exactly once", () => {
    const { onChange, commit, cancel } = editorSpies();
    render(
      <StrictMode>
        <checkboxCellType.Editor
          value={false}
          row={{}}
          column={noopColumnOf<boolean>()}
          onChange={onChange}
          commit={commit}
          cancel={cancel}
        />
      </StrictMode>,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("dateCellType display formatting", () => {
  it("toDisplayText falls back to toText (ISO) when no displayFormat is configured", () => {
    expect(dateCellType.toDisplayText!("2026-07-03")).toBe("2026-07-03");
    expect(dateCellType.toDisplayText!(null)).toBe("");
  });

  it("toDisplayText formats per displayFormat/locale when configured", () => {
    const options = { displayFormat: { year: "numeric", month: "short", day: "numeric" } as const, locale: "en-US" };
    expect(dateCellType.toDisplayText!("2026-07-03", options)).toBe("Jul 3, 2026");
  });

  it("toDisplayText without an explicit locale is deterministic (SSR hydration contract)", () => {
    const options = { displayFormat: { year: "numeric", month: "short", day: "numeric" } as const };
    // must not depend on the runtime's default locale, or server and client render different HTML
    expect(dateCellType.toDisplayText!("2026-07-03", options)).toBe("Jul 3, 2026");
  });

  it("toText always returns the raw ISO string regardless of displayFormat (clipboard/export contract)", () => {
    const options = { displayFormat: { year: "numeric", month: "short", day: "numeric" } as const };
    expect(dateCellType.toText("2026-07-03", options)).toBe("2026-07-03");
  });

  // Perf regression guard (2026-07-18 fling lane): constructing an Intl.DateTimeFormat per call
  // measured ~38us vs ~0.7us to reuse one, and ran once per date cell per newly-mounted row —
  // it dominated fling frame cost (100k benchmark: medium 32->54fps, fling 23->45fps, long tasks
  // 224->1 once cached). The cache must be keyed by option VALUE, since a column's `options`
  // literal is commonly re-created every render and would never hit an identity-keyed cache.
  it("reuses one Intl formatter across calls with equal-but-not-identical options", () => {
    const format = { year: "numeric", month: "short", day: "2-digit" } as const;
    // Warm the cache first: the spy stands in for the real constructor, so a genuine miss inside
    // the spied window would build (and cache) a mock formatter rather than a usable one.
    dateCellType.toDisplayText!("2026-07-03", { displayFormat: { ...format }, locale: "en-US" });
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    try {
      // fresh options objects each call, exactly as a re-rendering column literal produces
      dateCellType.toDisplayText!("2026-07-04", { displayFormat: { ...format }, locale: "en-US" });
      dateCellType.toDisplayText!("2026-07-05", { displayFormat: { ...format }, locale: "en-US" });
      expect(spy).toHaveBeenCalledTimes(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not let one cached formatter serve a different locale or format", () => {
    const day = "2026-07-03";
    const short = { year: "numeric", month: "short", day: "numeric" } as const;
    const numeric = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
    expect(dateCellType.toDisplayText!(day, { displayFormat: short, locale: "en-US" })).toBe("Jul 3, 2026");
    expect(dateCellType.toDisplayText!(day, { displayFormat: numeric, locale: "en-US" })).toBe("07/03/2026");
    expect(dateCellType.toDisplayText!(day, { displayFormat: short, locale: "de-DE" })).toBe("3. Juli 2026");
    // back to the first combination — the cache must still return ITS formatter, not the last one
    expect(dateCellType.toDisplayText!(day, { displayFormat: short, locale: "en-US" })).toBe("Jul 3, 2026");
  });
});

describe("selectCellType.Editor lifecycle", () => {
  it("opens on mount and picking an option commits with no movement", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <selectCellType.Editor
        value={null}
        row={{}}
        column={selectColumn()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const option = await screen.findByRole("option", { name: "Beta" });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 0 });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape closes and cancels without calling onChange", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = editorSpies();
    render(
      <selectCellType.Editor
        value={null}
        row={{}}
        column={selectColumn()}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    await screen.findByRole("option", { name: "Alpha" });
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});
