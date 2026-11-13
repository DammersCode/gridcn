import { Component, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataGridGlobalShortcuts, DataGridProvider } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridKeybindingsShortcut } from "@/registry/default/blocks/data-grid-keybindings/data-grid-keybindings";

class Catch extends Component<{ children: ReactNode; onError: (e: Error) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function thrownBy(child: ReactNode): string {
  let message = "";
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <Catch onError={(e) => (message = e.message)}>
      <DataGridProvider defaultData={[{ id: "1" }]} columns={[{ id: "a", header: "A", accessorKey: "id" }]}>
        {child}
      </DataGridProvider>
    </Catch>,
  );
  spy.mockRestore();
  return message;
}

describe("a root-only part mounted under the provider but outside DataGridRoot", () => {
  const message = "gridcn: this component or hook must be rendered inside a <DataGridRoot>.";

  it("DataGridKeybindingsShortcut outside DataGridRoot throws the shared message", () => {
    expect(thrownBy(<DataGridKeybindingsShortcut onOpen={() => {}} />)).toBe(message);
  });

  it("DataGridGlobalShortcuts outside DataGridRoot throws the shared message", () => {
    expect(thrownBy(<DataGridGlobalShortcuts />)).toBe(message);
  });
});
