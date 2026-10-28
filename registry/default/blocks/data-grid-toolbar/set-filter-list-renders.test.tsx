import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetFilterList, type SetFilterOption } from "./set-filter-list";

const checkboxRenders = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/components/ui/checkbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/checkbox")>();
  return {
    ...actual,
    Checkbox: (props: React.ComponentProps<typeof actual.Checkbox>) => {
      checkboxRenders.count++;
      return actual.Checkbox(props);
    },
  };
});

afterEach(cleanup);

const options: SetFilterOption[] = Array.from({ length: 200 }, (_, i) => ({ key: `v${i}`, label: `Value ${i}`, count: 1 }));
const noop = () => {};

const list = (checked: ReadonlySet<string>) => <SetFilterList options={options} checked={checked} onToggle={noop} onEnter={noop} idPrefix="t" ariaLabel="Values" />;

describe("SetFilterList rendering", () => {
  it("re-renders only the rows whose checked state changes", async () => {
    const view = await render(list(new Set(["v0"])));
    checkboxRenders.count = 0;
    await view.rerender(list(new Set(["v0", "v1"])));
    expect(checkboxRenders.count).toBe(1);
  });
});
