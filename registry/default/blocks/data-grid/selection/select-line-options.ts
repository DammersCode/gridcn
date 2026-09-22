import { CompactSelection } from "./compact-selection";
import type { CompactSelectionLike } from "../types";

/**
 * Options for selectRow/selectColumn. Plain click (no options set) toggles membership of
 * just this index, clearing the rest of the channel.
 */
export type SelectLineOptions = {
  /** Ctrl-click: additive toggle of this index, keeping the rest of the channel. */
  additive?: boolean;
  /** Shift-click: range from the last-selected index (falls back to `index` when there is none). */
  extendFromLast?: boolean;
  /**
   * The row-marker drag variant of `extendFromLast`: instead of ADDING the anchor..index span to
   * the channel (a union that can only grow), the channel becomes EXACTLY that span — the pointer
   * is the moving edge, so dragging back over already-selected rows shrinks the selection again.
   */
  replaceFromLast?: boolean;
  /**
   * Explicit last-highlighted index for `extendFromLast`/`replaceFromLast` (insertion order, not
   * the channel's max member — an RLE set can't represent insertion order, so the caller/reducer
   * must track it). Falls back to the channel's max index, then `index`, when absent.
   */
  from?: number;
};

/** Shared by selectRow/selectColumn: applies a plain/additive/extendFromLast toggle to one selection channel. */
export function selectLine(
  channelLike: CompactSelectionLike,
  index: number,
  opts: SelectLineOptions,
): CompactSelection {
  const channel = CompactSelection.fromArray(channelLike.toArray());
  if (opts.replaceFromLast) {
    const indices = channel.toArray();
    const last = opts.from ?? indices[indices.length - 1] ?? index;
    const start = Math.min(last, index);
    const end = Math.max(last, index) + 1;
    return CompactSelection.fromSingleSelection([start, end]);
  }
  if (opts.extendFromLast) {
    const indices = channel.toArray();
    const last = opts.from ?? indices[indices.length - 1] ?? index;
    const start = Math.min(last, index);
    const end = Math.max(last, index) + 1;
    return channel.add([start, end]);
  }
  if (opts.additive) {
    return channel.hasIndex(index) ? channel.remove(index) : channel.add(index);
  }
  // plain click: toggle-select just this index
  if (channel.length === 1 && channel.hasIndex(index)) {
    return CompactSelection.empty();
  }
  return CompactSelection.fromSingleSelection(index);
}
