/** Public entry point — the only module consumers/docs should import from. */
export { useDataGridPresence, useDataGridPresenceHighlights, type UseDataGridPresenceResult } from "./use-data-grid-presence";
export { isRowIdPresenceHighlight, isRowIdRangePresenceHighlight } from "./presence-store";
export {
  type PresenceHighlight,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
  type PresenceHighlightEntry,
  type PresenceStoreApi,
} from "./presence-store";
