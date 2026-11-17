import type { CellPatch, UpdateCellsOptions, UpdateCellsVerdict } from "./types";

type HeldPatch = { patch: CellPatch; options: UpdateCellsOptions };

/**
 * Holds `"stream"` patches whose row has a save in flight (verdict reason `"saving"`) and applies
 * them when the row's save settles, after the acknowledgement or the rollback. A later push to a
 * held cell replaces the held value.
 */
export function createStreamQueue(apply: (patches: readonly CellPatch[], options: UpdateCellsOptions) => void) {
  const held = new Map<string, Map<string, HeldPatch>>();

  const holdQueued = (patches: readonly CellPatch[], options: UpdateCellsOptions, verdict: UpdateCellsVerdict): void => {
    for (const skip of verdict.skipped) {
      if (skip.reason !== "saving") continue;
      const patch = patches[skip.patchIndex]!;
      let cells = held.get(patch.rowId);
      if (!cells) held.set(patch.rowId, (cells = new Map<string, HeldPatch>()));
      cells.delete(patch.columnId);
      cells.set(patch.columnId, { patch, options });
    }
  };

  return {
    hold(patches: readonly CellPatch[], options: UpdateCellsOptions, verdict: UpdateCellsVerdict): UpdateCellsVerdict {
      if (verdict.settled) void verdict.settled.then((settled) => holdQueued(patches, options, settled), () => {});
      else holdQueued(patches, options, verdict);
      return verdict;
    },
    /** Applies the held patches of every row that is no longer `"saving"` in `saveStatus`. */
    release(saveStatus: ReadonlyMap<string, string>): void {
      if (held.size === 0) return;
      const byOptions = new Map<UpdateCellsOptions, CellPatch[]>();
      for (const [rowId, cells] of held) {
        if (saveStatus.get(rowId) === "saving") continue;
        held.delete(rowId);
        for (const { patch, options } of cells.values()) {
          const group = byOptions.get(options);
          if (group) group.push(patch);
          else byOptions.set(options, [patch]);
        }
      }
      for (const [options, patches] of byOptions) apply(patches, options);
    },
  };
}
