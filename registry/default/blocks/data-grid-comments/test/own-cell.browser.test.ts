import { describe, expect, it } from "vitest";
import { GRID_ATTR } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { findOwnCell } from "../own-cell";

function gridHtml(tag: string): string {
  return `<div role="grid"><div data-scroll="${tag}"><div ${GRID_ATTR.rowIndex}="0"><div data-column-id="name" data-tag="${tag}"></div></div></div></div>`;
}

describe("findOwnCell", () => {
  it("skips a nested grid's cell at the same coordinates, even when it comes first in DOM order", () => {
    const host = document.createElement("div");
    host.innerHTML = `<div role="grid"><div data-scroll="host"><div ${GRID_ATTR.rowIndex}="0">${gridHtml("nested")}<div data-column-id="name" data-tag="host"></div></div></div></div>`;
    document.body.append(host);
    const scroll = host.querySelector<HTMLElement>('[data-scroll="host"]');
    expect(findOwnCell(scroll, 0, "name")?.dataset["tag"]).toBe("host");
    host.remove();
  });
});
