import { afterEach, describe, expect, it } from "vitest";
import type { ComponentType } from "react";
import { cleanup, render } from "@testing-library/react";
import { dateCellType, numberCellType, selectCellType, textCellType } from "./cell-types";
import { displayText } from "./display-text";

afterEach(cleanup);

const nullPrototype = () => Object.create(null);
const throwingProxy = () =>
  new Proxy({}, { get: () => { throw new Error("hostile"); } });
const hostileValues = { "null-prototype object": nullPrototype, "throwing proxy": throwingProxy };

const selectOptions = { choices: [{ value: "a", label: "A" }] };
const cases = [
  ["text", textCellType, undefined],
  ["number", numberCellType, { decimals: 2 }],
  ["select", selectCellType, selectOptions],
  ["date", dateCellType, undefined],
  ["date with displayFormat", dateCellType, { displayFormat: { year: "numeric" } }],
] as const;

describe.each(Object.entries(hostileValues))("hostile value: %s", (_label, make) => {
  it.each(cases)("%s: toText and displayText never throw", (_name, cellType, options) => {
    const type = cellType as never as Parameters<typeof displayText>[0];
    expect(() => type.toText(make(), options as never)).not.toThrow();
    expect(() => displayText(type, make(), options as never)).not.toThrow();
  });

  it.each(cases)("%s: the cell renders without throwing", (_name, cellType, options) => {
    const Cell = cellType.Cell as unknown as ComponentType<Record<string, unknown>>;
    expect(() => render(<Cell value={make()} options={options} />)).not.toThrow();
  });
});
