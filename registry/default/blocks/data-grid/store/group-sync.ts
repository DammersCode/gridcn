import type { ExpandedState, PivotSpec } from "../group-types";
import { NO_GROUPS, normalizeExpanded, normalizeGroupBy, sameExpanded, sameGroupBy } from "./group-state";
import type { AnyColumnDef, DataGridStoreState, InternalSyncProps } from "./types";

const MAX_ECHOES = 32;

export const EXPANDED_CUT_MESSAGE = "expanded holds more than 10,000 group ids, so the grid keeps the first 10,000";

/** What the sync pass remembers about the controlled group props: the last prop seen, and the values the grid emitted that no prop has confirmed yet. */
export type GroupSyncMemory = {
  groupByProp: readonly string[] | undefined;
  expandedProp: ExpandedState | undefined;
  groupByEcho: (readonly string[])[];
  expandedEcho: ExpandedState[];
  pivotProp: PivotSpec | undefined;
  pivotEcho: (PivotSpec | undefined)[];
};

export function initGroupMemory(init: Pick<InternalSyncProps, "groupBy" | "expanded" | "pivot">): GroupSyncMemory {
  return { groupByProp: init.groupBy, expandedProp: init.expanded, groupByEcho: [], expandedEcho: [], pivotProp: init.pivot, pivotEcho: [] };
}

/** The pivot column of an untrusted spec: its first id when that is a string, else none. */
export function normalizePivot(spec: PivotSpec | undefined): readonly string[] {
  const id: unknown = Array.isArray(spec?.columnIds) ? spec.columnIds[0] : undefined;
  return typeof id === "string" ? [id] : NO_GROUPS;
}

/** The pivot column after a sync, with the echo and equality rules of {@link syncGroupState}. */
export function syncPivotState(current: readonly string[], prop: PivotSpec | undefined, memory: GroupSyncMemory): readonly string[] {
  let next = current;
  if (prop === undefined) memory.pivotEcho.length = 0;
  else if (prop !== memory.pivotProp) {
    const echoed = memory.pivotEcho.indexOf(prop);
    if (echoed !== -1) memory.pivotEcho.splice(0, echoed + 1);
    else {
      memory.pivotEcho.length = 0;
      const given = normalizePivot(prop);
      if (!sameGroupBy(given, current)) next = given;
    }
  }
  memory.pivotProp = prop;
  return next;
}

/** Records a value the grid emitted so its echo from the controlled prop changes nothing. */
export function rememberEmitted<T>(queue: T[], value: T): void {
  queue.push(value);
  if (queue.length > MAX_ECHOES) queue.shift();
}

/** The first group columns: the prop, else the seed, normalized. */
export function initialGroupBy(init: Pick<InternalSyncProps, "groupBy" | "defaultGroupBy">, columns: readonly AnyColumnDef[]): readonly string[] {
  const seed = typeof init.defaultGroupBy === "function" ? undefined : init.defaultGroupBy;
  return normalizeGroupBy(init.groupBy ?? seed, columns);
}

export function initialExpanded(init: Pick<InternalSyncProps, "expanded" | "defaultExpanded">, onCut: () => void): ExpandedState {
  return normalizeExpanded(init.expanded ?? init.defaultExpanded, onCut);
}

/**
 * The group columns and the open groups after a sync. A controlled prop applies when it is a new value that no emitted
 * value explains; the echo of an emitted value, and a prop equal in content, change nothing. A prop that did not change
 * since the last sync never overrides a gesture. Equal values keep the identity of the current ones.
 */
export function syncGroupState(
  s: Pick<DataGridStoreState, "groupBy" | "expanded">,
  props: Pick<InternalSyncProps, "groupBy" | "expanded">,
  columns: readonly AnyColumnDef[],
  memory: GroupSyncMemory,
  onCut: () => void,
): GroupSyncInputsResult {
  let groupBy = s.groupBy;
  if (props.groupBy === undefined) memory.groupByEcho.length = 0;
  else if (props.groupBy !== memory.groupByProp) {
    const echoed = memory.groupByEcho.indexOf(props.groupBy);
    if (echoed !== -1) memory.groupByEcho.splice(0, echoed + 1);
    else {
      memory.groupByEcho.length = 0;
      const next = normalizeGroupBy(props.groupBy, columns);
      if (!sameGroupBy(next, groupBy)) groupBy = next;
    }
  }
  memory.groupByProp = props.groupBy;
  const kept = normalizeGroupBy(groupBy, columns);
  if (!sameGroupBy(kept, groupBy)) groupBy = kept;

  let expanded = s.expanded;
  if (props.expanded === undefined) memory.expandedEcho.length = 0;
  else if (props.expanded !== memory.expandedProp) {
    const echoed = memory.expandedEcho.indexOf(props.expanded);
    if (echoed !== -1) memory.expandedEcho.splice(0, echoed + 1);
    else {
      memory.expandedEcho.length = 0;
      const next = normalizeExpanded(props.expanded, onCut);
      if (!sameExpanded(next, expanded)) expanded = next;
    }
  }
  memory.expandedProp = props.expanded;
  return { groupBy, expanded, groupByControlled: props.groupBy !== undefined, expandedControlled: props.expanded !== undefined };
}

export type GroupSyncInputsResult = { groupBy: readonly string[]; expanded: ExpandedState; groupByControlled: boolean; expandedControlled: boolean };
