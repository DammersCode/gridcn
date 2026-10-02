import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCellEditor, type CellEditorCodec } from "./use-cell-editor";
import type { CellEditorProps, ColumnDef } from "../types";

afterEach(cleanup);

/** Number codec mirroring the built-in number type: "v"-prefixed draft, NaN -> null. */
const codec: CellEditorCodec<number | null> = {
  toDraft: (value) => (value == null ? "" : `v${value}`),
  toValue: (draft) => {
    const n = Number(draft);
    return Number.isNaN(n) ? null : n;
  },
};

type Props = CellEditorProps<unknown, number | null>;

function ProbeEditor(props: Props) {
  const { ref, ...rest } = useCellEditor(props, codec);
  return <input ref={ref} {...rest} aria-label="probe" />;
}

function makeProps(overrides: Partial<Props> = {}): Props {
  const column: ColumnDef<unknown, number | null> = { id: "col", header: "Col" };
  return {
    value: null,
    row: {},
    rowId: "r",
    columnId: "col",
    column,
    onChange: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

describe("useCellEditor", () => {
  it("seeds the draft from toDraft(value) when no initialText is given", () => {
    render(<ProbeEditor {...makeProps({ value: 5 })} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("v5");
  });

  it("seeds the draft from initialText (type-to-replace) over toDraft(value)", () => {
    render(<ProbeEditor {...makeProps({ value: 5, initialText: "x" })} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("x");
  });

  it("Enter parses the draft through the codec and commits with a down movement", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = makeProps();
    render(<ProbeEditor {...{ onChange, commit, cancel, value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(42);
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 1 });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("garbage input commits the codec's clearValue result (null), never throws", async () => {
    const user = userEvent.setup();
    const { onChange, commit } = makeProps();
    render(<ProbeEditor {...{ onChange, commit, cancel: vi.fn(), value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "abc");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(null);
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 1 });
  });

  it("Escape cancels without calling onChange or commit", async () => {
    const user = userEvent.setup();
    const { onChange, commit, cancel } = makeProps();
    render(<ProbeEditor {...{ onChange, commit, cancel, value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("blur commits the current parse with no movement", () => {
    const { onChange, commit, cancel } = makeProps();
    render(<ProbeEditor {...{ onChange, commit, cancel, value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(7);
    expect(commit).toHaveBeenCalledWith({ dx: 0, dy: 0 });
  });

  it("blur after an Enter commit does not commit a second time", async () => {
    const user = userEvent.setup();
    const { onChange, commit } = makeProps();
    render(<ProbeEditor {...{ onChange, commit, cancel: vi.fn(), value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Enter}");
    fireEvent.blur(input);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("re-arms the one-shot guard when rejectionCount rises, so a retry after a rejected async commit still lands", async () => {
    const user = userEvent.setup();
    const { onChange, commit } = makeProps();
    const { rerender } = render(<ProbeEditor {...{ onChange, commit, cancel: vi.fn(), value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" } }} />);
    const input = screen.getByRole("textbox");
    await user.type(input, "42");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    // the grid rejected the commit (async validation), editing stays open, rejectionCount 0 -> 1
    rerender(
      <ProbeEditor {...{ onChange, commit, cancel: vi.fn(), value: null, row: {}, rowId: "r", columnId: "col", column: { id: "col", header: "Col" }, rejectionCount: 1 }} />,
    );
    await user.type(input, "7");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("exposes readOnly mirroring pending so a rejected-commit retry keeps typing possible", () => {
    render(<ProbeEditor {...makeProps({ pending: true })} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    render(<ProbeEditor {...makeProps({ pending: false })} />);
    expect((screen.getAllByRole("textbox") as HTMLInputElement[]).at(-1)!.readOnly).toBe(false);
  });

  it("binds the column label, the pending state, and an automatic text direction", () => {
    function BareEditor(props: Props) {
      const { ref, ...rest } = useCellEditor(props, codec);
      return <input ref={ref} {...rest} />;
    }
    render(<BareEditor {...makeProps({ pending: true })} />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-label")).toBe("Col");
    expect(input.getAttribute("aria-busy")).toBe("true");
    expect(input.getAttribute("dir")).toBe("auto");
  });

  it("ignores Enter and Escape during IME composition", () => {
    const props = makeProps();
    render(<ProbeEditor {...props} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(props.commit).not.toHaveBeenCalled();
    expect(props.cancel).not.toHaveBeenCalled();
  });
});
