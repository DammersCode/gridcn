import { useEffect, useRef, useState } from "react";
import type { AnyColumnDef, DataGridActions } from "../store";
import { formatIssues, isStandardSchema } from "../validation/validate-cell";

/**
 * Intercepts a cell-type editor's `commit(movement)` to support an async Standard Schema
 * `validate` — the ONLY place this repo awaits validation (spec: "async branch lives at the
 * editor-commit layer, NOT inside a store action"). `commitCellEdit`/`computeCommit` stay fully
 * synchronous; a schema whose `~standard.validate` resolves synchronously (the function form, or a
 * sync schema) is forwarded to `commitCellEdit` immediately with ZERO behavior change.
 *
 * When the schema returns a Promise, editing STAYS OPEN: `pending` flips true (the editor sets its
 * input `readOnly` — minimal, reduced-motion-safe treatment that still allows Escape to cancel),
 * and only on resolution does this either call
 * `commitCellEdit(result.value, movement)` (success — the schema's own transformed value, per spec)
 * or, on issues, `actions.setEditingError(message)` (blocking default — editing continues, same as
 * the sync rejection UX, and the store bumps `editingRejectionCount` — the editors' commit-guard
 * re-arm nonce, single source of truth for sync AND async rejections; the editors re-arm off it,
 * never off "pending cleared", which also happens on Escape/cancel right before unmount) or
 * `commitCellEdit(value, movement, message)` (`onInvalid: "warn"` — the raw value commits and the
 * cell is flagged in `cellErrors`).
 *
 * Race guard: a generation counter bumped on every `commit()` call AND on unmount/cancel. A
 * resolution whose captured generation no longer matches current is dropped silently — covers
 * Escape/cancel, a newer commit superseding an in-flight one, and unmount.
 */
export function useAsyncValidate(actions: DataGridActions, column: AnyColumnDef) {
  const [pending, setPending] = useState(false);
  const generationRef = useRef(0);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
    };
  }, []);

  function commit(value: unknown, movement?: { dx: number; dy: number }): void {
    const validate = column.validate;
    if (!isStandardSchema(validate)) {
      actions.commitCellEdit(value, movement);
      return;
    }

    // Peek: a sync-resolving schema (including one that never returns a Promise at all) takes the
    // exact same path as today — computeCommit re-runs it, cheap and correct, see validate-cell.ts.
    const probe = validate["~standard"].validate(value);
    if (!(probe instanceof Promise)) {
      actions.commitCellEdit(value, movement);
      return;
    }

    const generation = ++generationRef.current;
    setPending(true);
    probe.then((result) => {
      if (generationRef.current !== generation) return; // stale: cancelled/superseded/unmounted
      setPending(false);
      if (result.issues) {
        const message = formatIssues(result.issues);
        // `onInvalid: "warn"`: commit the raw value and flag the cell — the awaited rejection is
        // forwarded because computeCommit's sync re-run cannot see a schema Promise's issues
        if (column.onInvalid === "warn") {
          actions.commitCellEdit(value, movement, message);
          return;
        }
        actions.setEditingError(message);
        return;
      }
      actions.commitCellEdit(result.value, movement);
    });
  }

  /** Escape/cancel while a validation is pending: invalidates it (its resolution is dropped) and clears `pending`. */
  function cancelPending(): void {
    generationRef.current += 1;
    setPending(false);
  }

  return { commit, cancelPending, pending };
}
