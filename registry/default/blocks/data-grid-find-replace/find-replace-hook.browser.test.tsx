import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridFindReplace, type UseDataGridFindReplaceOptions } from "./use-data-grid-find-replace";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 }] as const);

const hiddenColumns = defineColumns<Row & { secret: string }>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 200 },
  { id: "secret", header: "Secret", accessorKey: "secret", type: "text", hidden: true },
] as const);

function Harness({ onDataChange, withHidden, ...options }: UseDataGridFindReplaceOptions & { onDataChange?: (rows: readonly Row[]) => void; withHidden?: boolean }) {
  const findReplace = useDataGridFindReplace(options);
  const rows: (Row & { secret: string })[] = [
    { id: "a", name: "needle one", secret: "s" },
    { id: "b", name: "needle two", secret: "s" },
    { id: "c", name: "plain", secret: "s" },
  ];
  return (
    <DataGridProvider data={rows} columns={(withHidden ? hiddenColumns : columns) as typeof columns} getRowId={(r) => r.id} plugins={[findReplace.plugin]} onDataChange={onDataChange}>
      <button type="button" onClick={() => findReplace.open()}>
        Open search
      </button>
      <DataGridRoot className="h-[240px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

async function replaceAll(): Promise<void> {
  await page.getByRole("gridcell").first().click();
  await userEvent.keyboard("{Shift>}{Alt>}{Enter}{/Alt}{/Shift}");
  await userEvent.keyboard("needle");
  await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 of 2 cells");
  await userEvent.click(page.getByRole("textbox", { name: "Replace with" }));
  await userEvent.keyboard("pin");
  await userEvent.click(page.getByRole("button", { name: "Replace all" }));
}

describe("className", () => {
  it("merges into the panel root", async () => {
    await render(<Harness className="w-96" />);
    await page.getByRole("gridcell").first().click();
    await userEvent.keyboard("{Shift>}{Alt>}{Enter}{/Alt}{/Shift}");
    await expect.element(page.getByRole("dialog")).toHaveClass("w-96");
  });
});

describe("open", () => {
  it("opens the find mode by default, like Mod+F", async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole("button", { name: "Open search" }));
    await expect.element(page.getByRole("dialog")).toBeInTheDocument();
    expect(page.getByRole("textbox", { name: "Replace with" }).query()).toBeNull();
  });
});

describe("processReplace", () => {
  it("receives the plan, and what it returns is what gets written", async () => {
    const onDataChange = vi.fn();
    const processReplace = vi.fn(({ plan }: { plan: { patches: { rowId: string }[] } }) => ({ ...plan, patches: plan.patches.filter((patch) => patch.rowId === "a") }));
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("1 replaced");
    expect(processReplace.mock.calls[0]![0].plan.patches).toHaveLength(2);
    expect(processReplace.mock.calls[0]![0]).toHaveProperty("signal");
    const written = onDataChange.mock.calls.at(-1)![0] as Row[];
    expect(written.map((row) => row.name)).toEqual(["pin one", "needle two", "plain"]);
  });

  it("skips a patch on a hidden column, like the panel's own plan", async () => {
    const onDataChange = vi.fn();
    const processReplace = ({ plan }: { plan: { patches: { rowId: string; columnId: string; value: unknown }[] } }) => ({ ...plan, patches: [...plan.patches, { rowId: "c", columnId: "secret", value: "leak" }] });
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} withHidden />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("2 replaced, 1 skipped");
    const written = onDataChange.mock.calls.at(-1)![0] as (Row & { secret?: string })[];
    expect(written.map((row) => row.secret)).toEqual(["s", "s", "s"]);
  });

  it("writes nothing when the hook vetoes with false, and says so", async () => {
    const onDataChange = vi.fn();
    await render(<Harness processReplace={async () => false as const} onDataChange={onDataChange} />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("Replace cancelled");
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("cancels a plan with more patches than replaceAllLimit", async () => {
    const onDataChange = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      <Harness
        replaceAllLimit={1}
        processReplace={({ plan }) => ({ ...plan, patches: [...plan.patches, ...plan.patches, ...plan.patches] })}
        onDataChange={onDataChange}
      />,
    );
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("Replace cancelled");
    expect(onDataChange).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("cancels when the hook throws or returns something that is not a plan", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = await render(<Harness processReplace={() => Promise.reject(new Error("no"))} />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("Replace cancelled");
    await throwing.unmount();
    await render(<Harness processReplace={(() => ({ patches: "all" })) as never} />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("Replace cancelled");
    vi.restoreAllMocks();
  });

  it("drops a late answer after the find text changed", async () => {
    const onDataChange = vi.fn();
    let release!: (value: { patches: { rowId: string; columnId: string; value: string }[]; skipped: never[]; remaining: boolean }) => void;
    const processReplace = vi.fn(() => new Promise<{ patches: { rowId: string; columnId: string; value: string }[]; skipped: never[]; remaining: boolean }>((resolve) => (release = resolve)));
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} />);
    await replaceAll();
    await vi.waitFor(() => expect(processReplace).toHaveBeenCalled());
    await userEvent.click(page.getByRole("textbox", { name: "Find" }));
    await userEvent.keyboard("s");
    await new Promise((resolve) => setTimeout(resolve, 500));
    release({ patches: [{ rowId: "a", columnId: "name", value: "stale" }], skipped: [], remaining: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("drops a late answer when the replacement text or an option changes", async () => {
    const onDataChange = vi.fn();
    type Plan = { patches: { rowId: string; columnId: string; value: string }[]; skipped: never[]; remaining: boolean };
    let release!: (value: Plan) => void;
    const processReplace = vi.fn(() => new Promise<Plan>((resolve) => (release = resolve)));
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} />);
    await replaceAll();
    await vi.waitFor(() => expect(processReplace).toHaveBeenCalledTimes(1));
    await userEvent.click(page.getByRole("textbox", { name: "Replace with" }));
    await userEvent.keyboard("x");
    release({ patches: [{ rowId: "a", columnId: "name", value: "stale" }], skipped: [], remaining: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onDataChange).not.toHaveBeenCalled();

    await userEvent.click(page.getByRole("button", { name: "Replace all" }));
    await vi.waitFor(() => expect(processReplace).toHaveBeenCalledTimes(2));
    await userEvent.click(page.getByRole("button", { name: "Match case" }));
    release({ patches: [{ rowId: "a", columnId: "name", value: "stale" }], skipped: [], remaining: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("drops a late answer that arrives before the Find text is committed", async () => {
    const onDataChange = vi.fn();
    type Plan = { patches: { rowId: string; columnId: string; value: string }[]; skipped: never[]; remaining: boolean };
    let release!: (value: Plan) => void;
    const processReplace = vi.fn(() => new Promise<Plan>((resolve) => (release = resolve)));
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} />);
    await replaceAll();
    await vi.waitFor(() => expect(processReplace).toHaveBeenCalled());
    await userEvent.click(page.getByRole("textbox", { name: "Find" }));
    await userEvent.keyboard("s");
    release({ patches: [{ rowId: "a", columnId: "name", value: "stale" }], skipped: [], remaining: false });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("cancels a plan whose patches have no row and column ids", async () => {
    const onDataChange = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(<Harness processReplace={(() => ({ patches: [{ value: "x" }] })) as never} onDataChange={onDataChange} />);
    await replaceAll();
    await expect.element(page.getByRole("dialog").getByRole("status")).toHaveTextContent("Replace cancelled");
    expect(onDataChange).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("drops a late answer after the panel closed", async () => {
    const onDataChange = vi.fn();
    let release!: (value: false | { patches: never[]; skipped: never[]; remaining: boolean }) => void;
    const processReplace = vi.fn(() => new Promise<false | { patches: never[]; skipped: never[]; remaining: boolean }>((resolve) => (release = resolve)));
    await render(<Harness processReplace={processReplace as never} onDataChange={onDataChange} />);
    await replaceAll();
    await vi.waitFor(() => expect(processReplace).toHaveBeenCalled());
    const signal = (processReplace.mock.calls as unknown as [{ signal: AbortSignal }][])[0]![0].signal;
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    release({ patches: [], skipped: [], remaining: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onDataChange).not.toHaveBeenCalled();
  });
});
