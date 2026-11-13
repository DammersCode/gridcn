import { describe, expect, it } from "vitest";
import { DataGridHeader } from "@/registry/default/blocks/data-grid/data-grid";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { ALL_MODES, columns, makeRows, mountMode } from "./modes";

const renderHeaderMenu = ({ trigger }: { trigger: unknown }) => trigger;
const triggers = () => [...document.querySelectorAll<HTMLElement>(gridAttrSelector("headerMenuTrigger"))];

describe.each(ALL_MODES)("header tab stops without rows in mode %s", (mode) => {
  it("gives each column one tab stop while the view has no rows", async () => {
    await mountMode(mode, { rows: [], rootProps: { renderHeaderMenu }, Child: DataGridHeader });
    expect(triggers()).toHaveLength(columns.length);
    expect(triggers().map((t) => t.getAttribute("tabindex"))).toEqual(columns.map(() => "0"));
    expect(document.querySelector('[role="grid"]')).toHaveAttribute("tabindex", "-1");
  });

  it("takes the header buttons out of the tab order while rows exist", async () => {
    await mountMode(mode, { rows: makeRows(), rootProps: { renderHeaderMenu }, Child: DataGridHeader });
    expect(triggers().map((t) => t.getAttribute("tabindex"))).toEqual(columns.map(() => "-1"));
  });
});
