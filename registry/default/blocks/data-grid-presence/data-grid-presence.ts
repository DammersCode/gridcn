/** Public entry point — the only module consumers/docs should import from. */
export {
  useDataGridPresence,
  useDataGridPresenceHighlights,
  type UseDataGridPresenceOptions,
  type UseDataGridPresenceResult,
} from "./use-data-grid-presence";
export { MAX_RESOLVED_RECTS } from "./presence-overlay";
export { isRowIdPresenceHighlight, isRowIdRangePresenceHighlight } from "./presence-store";
export {
  type PresenceHighlight,
  type RowIdPresenceHighlight,
  type RowIdRangePresenceHighlight,
  type PresenceHighlightEntry,
  type PresenceStoreApi,
} from "./presence-store";
