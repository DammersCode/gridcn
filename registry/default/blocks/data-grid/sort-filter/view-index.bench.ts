import { test } from "vitest";
import { numberCellType } from "../cell-types/number";
import { buildViewIndex, type CellAccessor } from "./build-view-index";
import { defaultCompareText } from "./default-compare-text";

const ROW_COUNT = 100_000;

type Row = { id: string; name: string; score: number };

const rows: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: `row-${i}`,
  name: `Person ${(i * 7919) % ROW_COUNT}`,
  score: (i * 7919) % 1000,
}));

const textAccessor: CellAccessor = {
  getText: (rowIndex, columnId) => String(rows[rowIndex]![columnId as keyof Row]),
};

const rawCellValue = (row: Row): number => row["score"];

const typedAccessor: CellAccessor = {
  ...textAccessor,
  compare: (columnId) => {
    const compare = numberCellType.compare;
    if (columnId !== "score" || !compare) return undefined;
    return (a, b) => {
      const rowA = rows[a];
      const rowB = rows[b];
      if (rowA === undefined || rowB === undefined) return 0;
      const valueA = rawCellValue(rowA);
      const valueB = rawCellValue(rowB);
      try {
        const result = compare(valueA, valueB, undefined);
        if (Number.isFinite(result)) return result;
      } catch {
        // fall through to the text compare
      }
      return defaultCompareText(String(valueA), String(valueB));
    };
  },
};

const indices = Array.from({ length: ROW_COUNT }, (_, i) => i);
const keys = indices.map((i) => textAccessor.getText(i, "name"));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const sorts = [{ columnId: "name", direction: "asc" as const }];

test("sort phases at 100k rows", async ({ bench }) => {
  await bench.compare(
    bench("key extraction (getText per row)", () => {
      for (const i of indices) textAccessor.getText(i, "name");
    }),
    bench("compare with prebuilt keys", () => {
      indices.slice().sort((a, b) => defaultCompareText(keys[a]!, keys[b]!, collator));
    }),
    bench("buildViewIndex, text sort", () => {
      buildViewIndex(ROW_COUNT, textAccessor, { sorts, filters: [] });
    }),
    bench("buildViewIndex, typed compare (raw value read twice per comparison)", () => {
      buildViewIndex(ROW_COUNT, typedAccessor, { sorts: [{ columnId: "score", direction: "asc" }], filters: [] });
    }),
    { time: 0, iterations: 15 },
  );
}, 300_000);
