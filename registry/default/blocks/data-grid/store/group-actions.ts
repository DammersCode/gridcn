import type { StoreApi } from "zustand/vanilla";
import type { ExpandedState } from "../group-types";
import { selectCell } from "../selection";
import { flattenGroupTree, groupIdsOfRow, type GroupTree } from "../sort-filter/build-group-view";
import { computeSearchMatches, computeViewIndex, viewFilters, viewSorts, viewWindowOf, windowView } from "./compute";
import { emitAfterWrites, resetDeferredRows, type DataWriteContext } from "./data-write";
import { groupAnnouncementLabel, nextAnnouncement } from "./announcements";
import { EXPANDED, COLLAPSED, expandedTest, normalizeExpanded, normalizeGroupBy, sameExpanded, sameGroupBy, toggleExpanded } from "./group-state";
import { rememberEmitted } from "./group-sync";
import { groupingOf, warnGroupOnce } from "./group-view";
import { viewRowOfDataIndex } from "./row-index";
import { clearStaleRows } from "./server-stale";
import type { FollowView, SyncMemory } from "./sync-props";
import type { DataGridActions, DataGridStoreState } from "./types";
import { dataIndexAt, registerGroupLayout, viewRowOfGroupId } from "./view-rows";

type GroupActions = Pick<DataGridActions, "setGroupBy" | "toggleGroupBy" | "setExpanded" | "toggleGroup" | "expandAll" | "collapseAll">;

type Deps = {
  set: StoreApi<DataGridStoreState>["setState"];
  get: StoreApi<DataGridStoreState>["getState"];
  dataWrite: DataWriteContext;
  followView: FollowView;
  memory: SyncMemory;
};

/** When the cursor sat on a row that a collapse hid, the cursor and the selection move to the nearest group row that still shows. */
function anchorOnGroup(s: DataGridStoreState, view: readonly number[], tree: GroupTree, followed: Partial<DataGridStoreState>): Partial<DataGridStoreState> {
  const active = s.activeCell;
  const dataIndex = active ? dataIndexAt(s, active.row) : undefined;
  if (!active || dataIndex === undefined || viewRowOfDataIndex(view, dataIndex) !== -1) return {};
  for (const id of groupIdsOfRow(tree, dataIndex)) {
    const row = viewRowOfGroupId(view, id);
    if (row === -1) continue;
    const coord = { row, col: active.col };
    return { activeCell: coord, selection: { ...(followed.selection ?? s.selection), current: selectCell(coord).current } };
  }
  return {};
}

export function createGroupActions({ set, get, dataWrite, followView, memory }: Deps): GroupActions {
  const patchFor = (s: DataGridStoreState, viewIndex: number[]): Partial<DataGridStoreState> => ({
    viewIndex,
    ...followView(s, viewIndex, s.visibleColumns),
    ...computeSearchMatches(s.data, s.columns, viewIndex, s.visibleColumns, s.searchText, s.cellTypes, s.searchOptions),
  });

  const regroup = (s: DataGridStoreState, groupBy: readonly string[]): Partial<DataGridStoreState> => {
    const grouping = groupingOf({ ...s, groupBy });
    const page = s.pageSize === null || s.pageControlled ? s.page : 1;
    const viewIndex = computeViewIndex(s.data, s.columns, viewSorts(s.sortMode, s.sortState), viewFilters(s.filterMode, s.filterState, s.filterJoin), s.viewIndex, s.cellTypes, viewWindowOf({ ...s, page }), s.sortLocale, grouping);
    resetDeferredRows(dataWrite);
    return { groupBy, page, ...clearStaleRows(dataWrite), ...patchFor(s, viewIndex) };
  };

  const reopen = (s: DataGridStoreState, expanded: ExpandedState): Partial<DataGridStoreState> => {
    const tree = s.groupLayout?.tree as GroupTree | undefined;
    if (!tree) return { expanded };
    const { viewIndex: full, layout } = flattenGroupTree(tree, expanded);
    registerGroupLayout(full, layout);
    const viewIndex = windowView(full, viewWindowOf(s), s.viewIndex);
    const patch = patchFor(s, viewIndex);
    return { expanded, ...patch, ...anchorOnGroup(s, viewIndex, tree, patch) };
  };

  const commitGroupBy = (requested: readonly string[]): void => {
    const s = get();
    const groupBy = normalizeGroupBy(requested, s.columns);
    if (sameGroupBy(groupBy, s.groupBy)) return;
    set((s2) => regroup(s2, groupBy));
    memory.lastSyncInputs = { ...memory.lastSyncInputs, groupBy };
    if (s.groupByControlled) rememberEmitted(memory.group.groupByEcho, groupBy);
    emitAfterWrites(dataWrite, () => s.onGroupByChange?.(groupBy), () => {
      if (s.pageSize !== null && s.page !== 1) s.onPageChange?.(1);
    });
  };

  const commitExpanded = (requested: ExpandedState): void => {
    const s = get();
    const normalized = normalizeExpanded(requested);
    const expanded = s.groupMode === "server" && normalized.mode === "expanded" ? COLLAPSED : normalized;
    if (expanded !== normalized) warnGroupOnce(s.dataWrite, "server expand all", 'expanded mode "expanded" is not available under groupMode="server": the grid keeps every group collapsed');
    if (sameExpanded(expanded, s.expanded)) return;
    set((s2) => reopen(s2, expanded));
    memory.lastSyncInputs = { ...memory.lastSyncInputs, expanded };
    if (s.expandedControlled) rememberEmitted(memory.group.expandedEcho, expanded);
    emitAfterWrites(dataWrite, () => s.onExpandedChange?.(expanded));
  };

  return {
    setGroupBy: commitGroupBy,
    toggleGroupBy(columnId) {
      const { groupBy } = get();
      commitGroupBy(groupBy.includes(columnId) ? groupBy.filter((id) => id !== columnId) : [...groupBy, columnId]);
    },
    setExpanded: commitExpanded,
    toggleGroup(groupId) {
      const s = get();
      const node = s.groupLayout?.rows.find((row) => row.id === groupId);
      const opens = !expandedTest(s.expanded)(groupId);
      const next = toggleExpanded(s.expanded, groupId);
      if (next === s.expanded) {
        if (opens) set((s2) => ({ liveAnnouncement: nextAnnouncement(s2.liveAnnouncement, "groupTooManyOpen", 0) }));
        return;
      }
      commitExpanded(next);
      if (!node) return;
      set((s2) => ({ liveAnnouncement: nextAnnouncement(s2.liveAnnouncement, opens ? "groupExpanded" : "groupCollapsed", node.count, false, groupAnnouncementLabel(s2, node)) }));
    },
    expandAll() {
      if (get().groupMode === "server") return { ok: false, reason: "server-groups" };
      commitExpanded(EXPANDED);
      return { ok: true };
    },
    collapseAll() {
      commitExpanded(COLLAPSED);
      return { ok: true };
    },
  };
}
