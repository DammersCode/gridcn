/** Domain barrel — clipboard parse/serialize + the grid/data-grid clipboard hooks. */
export { serializeCells } from "./serialize-cells";
export { parseClipboardHtml, parseClipboardText, parseClipboard } from "./parse-clipboard";
export {
  useGridClipboard,
  resolveCopyScope,
  serializeRect,
  serializeCopyScope,
  tileToHeight,
  resolvePasteTarget,
  targetHeight,
  buildPasteCandidates,
  buildPasteWrites,
  pasteText,
  type UseGridClipboardOptions,
  type CopyScope,
} from "./use-grid-clipboard";
export {
  useDataGridClipboard,
  type UseDataGridClipboardResult,
  type PasteFromClipboardResult,
} from "./use-data-grid-clipboard";
