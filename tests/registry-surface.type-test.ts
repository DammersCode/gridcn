// Compile-time guard: the add-on-only types live on `data-grid-sdk`, never on the `data-grid` consumer barrel.
// @ts-expect-error DataGridStoreState moved to data-grid-sdk
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error DataGridFilterOperatorLabels moved to data-grid-sdk
import type { DataGridFilterOperatorLabels } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error GridAttrName moved to data-grid-sdk
import type { GridAttrName } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error GridAttr moved to data-grid-sdk
import type { GridAttr } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error GridAttrValue moved to data-grid-sdk
import type { GridAttrValue } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error History moved to data-grid-sdk
import type { History } from "@/registry/default/blocks/data-grid/data-grid";
// @ts-expect-error HistoryOptions moved to data-grid-sdk
import type { HistoryOptions } from "@/registry/default/blocks/data-grid/data-grid";
import type * as Sdk from "@/registry/default/blocks/data-grid/data-grid-sdk";

export type MovedTypesStillExist = [
  Sdk.DataGridStoreState,
  Sdk.DataGridFilterOperatorLabels,
  Sdk.GridAttrName,
  Sdk.GridAttr,
  Sdk.GridAttrValue,
  Sdk.History<unknown>,
  Sdk.HistoryOptions,
];
export type ImportedNames = [DataGridStoreState, DataGridFilterOperatorLabels, GridAttrName, GridAttr, GridAttrValue, History, HistoryOptions];
