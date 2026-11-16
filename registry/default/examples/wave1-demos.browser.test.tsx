import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import ClipboardDemo from "@/registry/default/examples/data-grid-clipboard-demo";
import ColorsRadiusDemo from "@/registry/default/examples/data-grid-colors-radius-demo";
import DensityDemo from "@/registry/default/examples/data-grid-density-demo";
import DetailPanelDemo from "@/registry/default/examples/data-grid-detail-panel-demo";
import KeyboardDemo from "@/registry/default/examples/data-grid-keyboard-demo";
import PointerDemo from "@/registry/default/examples/data-grid-pointer-demo";
import QuickSearchDemo from "@/registry/default/examples/data-grid-quick-search-demo";
import ToolbarDemo from "@/registry/default/examples/data-grid-toolbar-demo";
import "@/app/global.css";

const DEMOS = [
  ["clipboard", <ClipboardDemo key="clipboard" />],
  ["colors-radius", <ColorsRadiusDemo key="colors-radius" />],
  ["density", <DensityDemo key="density" />],
  ["detail-panel", <DetailPanelDemo key="detail-panel" />],
  ["keyboard", <KeyboardDemo key="keyboard" />],
  ["pointer", <PointerDemo key="pointer" />],
  ["quick-search", <QuickSearchDemo key="quick-search" />],
  ["toolbar", <ToolbarDemo key="toolbar" />],
] as const;

describe("docs demos mount", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error");
  });
  afterEach(() => errors.mockRestore());

  for (const [name, el] of DEMOS) {
    it(`${name} demo renders a grid with rows and no console errors`, async () => {
      await render(el);
      await new Promise((r) => setTimeout(r, 300));
      expect(document.querySelector('[role="grid"]')).not.toBeNull();
      expect(document.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
      expect(errors).not.toHaveBeenCalled();
    });
  }
});
