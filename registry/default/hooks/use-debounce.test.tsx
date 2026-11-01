import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebounce, useDebouncedInput } from "./use-debounce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebounce", () => {
  it("follows the value once it stays still for the delay", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), { initialProps: { value: "a" } });
    rerender({ value: "ab" });
    expect(result.current).toBe("a");
    act(() => void vi.advanceTimersByTime(199));
    expect(result.current).toBe("a");
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe("ab");
  });

  it("restarts the wait on every change and defaults to 300 ms", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: 1 } });
    rerender({ value: 2 });
    act(() => void vi.advanceTimersByTime(250));
    rerender({ value: 3 });
    act(() => void vi.advanceTimersByTime(250));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toBe(3);
  });

  it("returns the value at once for a delay of 0", () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 0), { initialProps: { value: "a" } });
    rerender({ value: "b" });
    expect(result.current).toBe("b");
  });
});

function Field(props: { onCommit: (next: string) => void; delayMs?: number; value?: string }) {
  const [committed, setCommitted] = useState(props.value ?? "");
  const input = useDebouncedInput(
    committed,
    (next) => {
      setCommitted(next);
      props.onCommit(next);
    },
    props.delayMs === undefined ? undefined : { delayMs: props.delayMs },
  );
  return (
    <>
      <input aria-label="field" {...input.inputProps} />
      <output>{committed}</output>
    </>
  );
}

const type = (el: HTMLElement, text: string) => fireEvent.change(el, { target: { value: text } });

describe("useDebouncedInput", () => {
  it("shows each keystroke at once and commits once typing pauses (default 300 ms)", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} />);
    const input = view.getByLabelText("field") as HTMLInputElement;
    type(input, "a");
    type(input, "ab");
    expect(input.value).toBe("ab");
    act(() => void vi.advanceTimersByTime(299));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("ab");
  });

  it("commits each keystroke for a delay of 0", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} delayMs={0} />);
    const input = view.getByLabelText("field");
    type(input, "a");
    type(input, "ab");
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual(["a", "ab"]);
  });

  it("commits on blur", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} />);
    const input = view.getByLabelText("field");
    type(input, "abc");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("abc");
    act(() => void vi.advanceTimersByTime(1000));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("commits on Enter, and Escape drops the pending text", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} value="start" />);
    const input = view.getByLabelText("field") as HTMLInputElement;
    type(input, "x");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("start");
    act(() => void vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();
    type(input, "y");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("y");
  });

  it("commits a pending value when the component unmounts", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} />);
    type(view.getByLabelText("field"), "last");
    view.unmount();
    expect(onCommit).toHaveBeenCalledWith("last");
  });

  it("does not commit twice under StrictMode", () => {
    const onCommit = vi.fn();
    const view = render(
      <StrictMode>
        <Field onCommit={onCommit} />
      </StrictMode>,
    );
    type(view.getByLabelText("field"), "once");
    act(() => void vi.advanceTimersByTime(300));
    view.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("waits for the end of an IME composition and ignores Enter during it", () => {
    const onCommit = vi.fn();
    const view = render(<Field onCommit={onCommit} />);
    const input = view.getByLabelText("field") as HTMLInputElement;
    fireEvent.compositionStart(input);
    type(input, "に");
    type(input, "にほ");
    act(() => void vi.advanceTimersByTime(1000));
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    act(() => void vi.advanceTimersByTime(300));
    expect(onCommit).toHaveBeenCalledWith("にほ");
  });

  it("keeps the typed text when an older commit echoes back late", () => {
    function Echo() {
      const [value, setValue] = useState("");
      const input = useDebouncedInput(value, () => {}, { delayMs: 300 });
      return (
        <>
          <input aria-label="echo" {...input.inputProps} />
          <button onClick={() => setValue("old")}>echo</button>
        </>
      );
    }
    const view = render(<Echo />);
    const input = view.getByLabelText("echo") as HTMLInputElement;
    type(input, "new text");
    fireEvent.click(view.getByText("echo"));
    expect(input.value).toBe("new text");
  });

  it("adopts a new value from outside when nothing is pending", () => {
    function Outer() {
      const [value, setValue] = useState("a");
      const input = useDebouncedInput(value, setValue);
      return (
        <>
          <input aria-label="o" {...input.inputProps} />
          <button onClick={() => setValue("reset")}>reset</button>
        </>
      );
    }
    const view = render(<Outer />);
    fireEvent.click(view.getByText("reset"));
    expect((view.getByLabelText("o") as HTMLInputElement).value).toBe("reset");
  });

  it("uses the latest onCommit, not the one from the first render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useDebouncedInput("", cb), { initialProps: { cb: first } });
    act(() => result.current.inputProps.onChange({ target: { value: "z" } } as never));
    rerender({ cb: second });
    act(() => void vi.advanceTimersByTime(300));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("z");
  });
});

describe("useDebouncedInput with a parent that applies the commit a render later", () => {
  it("never shows the old text after the commit", () => {
    const seen: string[] = [];
    function Late() {
      const [value, setValue] = useState("");
      const [queued, setQueued] = useState<string | null>(null);
      const input = useDebouncedInput(value, (next) => setQueued(next));
      seen.push(input.inputValue);
      useEffect(() => {
        if (queued !== null) setValue(queued);
      }, [queued]);
      return <input aria-label="late" {...input.inputProps} />;
    }
    const view = render(<Late />);
    type(view.getByLabelText("late"), "ab");
    act(() => void vi.advanceTimersByTime(300));
    expect((view.getByLabelText("late") as HTMLInputElement).value).toBe("ab");
    expect(seen.slice(seen.indexOf("ab")).every((text) => text === "ab")).toBe(true);
  });

  it("does not bring the typed text back when value later returns to the value the typing started from", () => {
    function Outer() {
      const [value, setValue] = useState("");
      const input = useDebouncedInput(value, setValue, { delayMs: 0 });
      return (
        <>
          <input aria-label="y" {...input.inputProps} />
          <button onClick={() => setValue("")}>clear</button>
        </>
      );
    }
    const view = render(<Outer />);
    type(view.getByLabelText("y"), "ab");
    expect((view.getByLabelText("y") as HTMLInputElement).value).toBe("ab");
    fireEvent.click(view.getByText("clear"));
    expect((view.getByLabelText("y") as HTMLInputElement).value).toBe("");
  });

  it("two inputs sharing one value both follow it", () => {
    function Pair() {
      const [value, setValue] = useState("");
      const first = useDebouncedInput(value, setValue, { delayMs: 0 });
      const second = useDebouncedInput(value, setValue, { delayMs: 0 });
      return (
        <>
          <input aria-label="one" {...first.inputProps} />
          <input aria-label="two" {...second.inputProps} />
        </>
      );
    }
    const view = render(<Pair />);
    type(view.getByLabelText("one"), "ab");
    expect((view.getByLabelText("two") as HTMLInputElement).value).toBe("ab");
    type(view.getByLabelText("two"), "");
    expect((view.getByLabelText("one") as HTMLInputElement).value).toBe("");
  });

  it("typing during a slow commit does not flash the older text", () => {
    const seen: string[] = [];
    function Slow() {
      const [value, setValue] = useState("");
      const [queue, setQueue] = useState<string[]>([]);
      const input = useDebouncedInput(value, (next) => setQueue((q) => [...q, next]));
      seen.push(input.inputValue);
      return (
        <>
          <input aria-label="slow" {...input.inputProps} />
          <button onClick={() => setValue(queue[0] ?? "")}>apply</button>
        </>
      );
    }
    const view = render(<Slow />);
    type(view.getByLabelText("slow"), "ab");
    act(() => void vi.advanceTimersByTime(300));
    type(view.getByLabelText("slow"), "abc");
    fireEvent.click(view.getByText("apply"));
    act(() => void vi.advanceTimersByTime(300));
    expect(seen.slice(seen.lastIndexOf("abc")).every((text) => text === "abc")).toBe(true);
  });

  it("an older commit that echoes after a newer commit does not replace the typed text", () => {
    function TwoCommits() {
      const [value, setValue] = useState("");
      const [committed, setCommitted] = useState<string[]>([]);
      const input = useDebouncedInput(value, (next) => setCommitted((list) => [...list, next]));
      return (
        <>
          <input aria-label="two" {...input.inputProps} />
          <button onClick={() => setValue(committed[0] ?? "")}>echo first</button>
        </>
      );
    }
    const view = render(<TwoCommits />);
    type(view.getByLabelText("two"), "ab");
    act(() => void vi.advanceTimersByTime(300));
    type(view.getByLabelText("two"), "abc");
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.click(view.getByText("echo first"));
    expect((view.getByLabelText("two") as HTMLInputElement).value).toBe("abc");
  });

  it("echoes in order through a repeated text end on the typed text and never stick", () => {
    function Repeat() {
      const [value, setValue] = useState("");
      const [committed, setCommitted] = useState<string[]>([]);
      const [applied, setApplied] = useState(0);
      const input = useDebouncedInput(value, (next) => setCommitted((list) => [...list, next]));
      return (
        <>
          <input aria-label="rep" {...input.inputProps} />
          <button
            onClick={() => {
              setValue(committed[applied] ?? "");
              setApplied((n) => n + 1);
            }}
          >
            apply
          </button>
        </>
      );
    }
    const view = render(<Repeat />);
    const field = view.getByLabelText("rep") as HTMLInputElement;
    for (const text of ["a", "ab", "a"]) {
      type(field, text);
      act(() => void vi.advanceTimersByTime(300));
    }
    fireEvent.click(view.getByText("apply"));
    fireEvent.click(view.getByText("apply"));
    fireEvent.click(view.getByText("apply"));
    expect(field.value).toBe("a");
  });

  it("a reset to the first value after a partial echo shows value, and so does an undo to an echoed text", () => {
    function Steps() {
      const [value, setValue] = useState("");
      const [committed, setCommitted] = useState<string[]>([]);
      const input = useDebouncedInput(value, (next) => setCommitted((list) => [...list, next]));
      return (
        <>
          <input aria-label="st" {...input.inputProps} />
          <button onClick={() => setValue(committed[0] ?? "")}>first</button>
          <button onClick={() => setValue("")}>clear</button>
          <button onClick={() => setValue("a")}>undo</button>
        </>
      );
    }
    const view = render(<Steps />);
    const field = view.getByLabelText("st") as HTMLInputElement;
    type(field, "a");
    act(() => void vi.advanceTimersByTime(300));
    type(field, "ab");
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.click(view.getByText("first"));
    expect(field.value).toBe("ab");
    fireEvent.click(view.getByText("clear"));
    expect(field.value).toBe("");
    type(field, "abc");
    act(() => void vi.advanceTimersByTime(300));
    fireEvent.click(view.getByText("undo"));
    expect(field.value).toBe("a");
  });

  it("the echo of a commit older than the queue counts as a change from outside", () => {
    function Lag() {
      const [value, setValue] = useState("");
      const input = useDebouncedInput(value, () => {}, { delayMs: 0 });
      return (
        <>
          <input aria-label="lag" {...input.inputProps} />
          <button onClick={() => setValue("t0")}>old echo</button>
        </>
      );
    }
    const view = render(<Lag />);
    const field = view.getByLabelText("lag") as HTMLInputElement;
    for (let i = 0; i < 70; i++) type(field, `t${i}`);
    fireEvent.click(view.getByText("old echo"));
    expect(field.value).toBe("t0");
  });

  it("the queue holds the last 64 commits: the echo of the 65th newest is outside, the 64th newest is not", () => {
    function Edge({ echo }: { echo: string }) {
      const [value, setValue] = useState("");
      const input = useDebouncedInput(value, () => {}, { delayMs: 0 });
      return (
        <>
          <input aria-label="edge" {...input.inputProps} />
          <button onClick={() => setValue(echo)}>echo</button>
        </>
      );
    }
    const typeSeventy = (view: ReturnType<typeof render>) => {
      for (let i = 0; i < 70; i++) type(view.getByLabelText("edge"), `t${i}`);
    };
    const outside = render(<Edge echo="t5" />);
    typeSeventy(outside);
    fireEvent.click(outside.getByText("echo"));
    expect((outside.getByLabelText("edge") as HTMLInputElement).value).toBe("t5");
    cleanup();
    const inside = render(<Edge echo="t6" />);
    typeSeventy(inside);
    fireEvent.click(inside.getByText("echo"));
    expect((inside.getByLabelText("edge") as HTMLInputElement).value).toBe("t69");
  });

  it("an outside value after many commits in flight shows value", () => {
    function Many() {
      const [value, setValue] = useState("");
      const input = useDebouncedInput(value, () => {});
      return (
        <>
          <input aria-label="many" {...input.inputProps} />
          <button onClick={() => setValue("outside")}>outside</button>
        </>
      );
    }
    const view = render(<Many />);
    const field = view.getByLabelText("many") as HTMLInputElement;
    for (let i = 0; i < 10; i++) {
      type(field, `t${i}`);
      act(() => void vi.advanceTimersByTime(300));
    }
    fireEvent.click(view.getByText("outside"));
    expect(field.value).toBe("outside");
  });

  it("useDebounce returns the latest value after the delay changes from 0 to a positive number", () => {
    const { result, rerender } = renderHook(({ value, delayMs }) => useDebounce(value, delayMs), { initialProps: { value: "a", delayMs: 0 } });
    rerender({ value: "b", delayMs: 0 });
    rerender({ value: "b", delayMs: 100 });
    expect(result.current).toBe("b");
  });

  it("shows value again once the parent moves it away from the value the typing started from", () => {
    function Outer() {
      const [value, setValue] = useState("a");
      const input = useDebouncedInput(value, () => {});
      return (
        <>
          <input aria-label="x" {...input.inputProps} />
          <button onClick={() => setValue("reset")}>reset</button>
        </>
      );
    }
    const view = render(<Outer />);
    type(view.getByLabelText("x"), "typed");
    fireEvent.blur(view.getByLabelText("x"));
    expect((view.getByLabelText("x") as HTMLInputElement).value).toBe("typed");
    fireEvent.click(view.getByText("reset"));
    expect((view.getByLabelText("x") as HTMLInputElement).value).toBe("reset");
  });
});
