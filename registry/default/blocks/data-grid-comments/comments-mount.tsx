"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { useDataGridActiveCell, useDataGridApi, useDataGridKeymap, useDataGridReadOnly, type DataGridApi } from "@/registry/default/blocks/data-grid/data-grid";
import { GRID_ATTR, isDev, rowIdAtViewRow, useDataGridContainer } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { CommentPopoverHost } from "./comment-popover";
import { findOwnCell } from "./own-cell";
import { cellComments } from "./comment-state";
import type { CommentEngine, GridAdapter } from "./comment-engine";
import { resolveCommentsLabels } from "./labels";
import type { UseDataGridCommentsOptions } from "./types";

const ANNOUNCE_DEBOUNCE_MS = 250;
const OPEN_WAIT_FRAMES = 10;

function humanizeChord(binding: string | undefined): string {
  if (!binding) return "";
  return binding
    .split("+")
    .map((part) => (part.length > 1 ? part.charAt(0).toUpperCase() + part.slice(1) : part.toUpperCase()))
    .join("+");
}

/** Empties the live region before each message so a repeated text is read again. */
function createSpeaker(setText: (text: string) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    say(message: string): void {
      setText("");
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setText(message), 30);
    },
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
    },
  };
}

function Announcer({ engine, getOptions }: { engine: CommentEngine; getOptions: () => UseDataGridCommentsOptions }): ReactNode {
  const api = useDataGridApi();
  const scrollRef = useDataGridContainer();
  const activeCell = useDataGridActiveCell();
  const keymap = useDataGridKeymap();
  const announcement = useStore(engine.store.ui, (s) => s.announcement);
  const revision = useStore(engine.store.ui, (s) => s.revision);
  const [text, setText] = useState("");
  const [mounted, setMounted] = useState(false);
  const [speaker] = useState(() => createSpeaker(setText));
  const [last] = useState(() => ({ key: "" }));
  const chord = humanizeChord(keymap["openComments"]?.[0]);

  useEffect(() => setMounted(true), []);
  useEffect(() => () => speaker.dispose(), [speaker]);

  useEffect(() => {
    if (announcement.nonce > 0 && announcement.text) speaker.say(announcement.text);
  }, [announcement, speaker]);

  useEffect(() => {
    if (!activeCell) return;
    const timer = setTimeout(() => {
      const scroll = scrollRef.current;
      const focus = document.activeElement;
      const inside = focus !== null && ((scroll?.contains(focus) ?? false) || focus.closest(`[${GRID_ATTR.commentsPopup}]`) !== null);
      if (!inside) return;
      const state = api.store.getState();
      const rowId = rowIdAtViewRow(state, activeCell.row);
      const columnId = state.visibleColumns[activeCell.col]?.id;
      if (rowId === undefined || columnId === undefined) return;
      const entries = cellComments(engine.store.core, rowId, columnId);
      const options = getOptions();
      const hidden = options.hideResolved === true && options.enableResolve !== false && entries.every((e) => e.comment.resolved);
      if (entries.length === 0 || hidden) {
        last.key = "";
        return;
      }
      const key = `${rowId}\u0001${columnId}`;
      if (last.key === key) return;
      last.key = key;
      const labels = resolveCommentsLabels(options.labels);
      if (options.enableResolve === false) speaker.say(labels.announceCount(entries.length, chord));
      else speaker.say(labels.announce(entries.length, entries.filter((e) => !e.comment.resolved).length, chord));
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeCell, revision, api, engine, scrollRef, getOptions, speaker, last, chord]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-grid-comments-announcer="">
      {text}
    </div>,
    document.body,
  );
}

function findCell(scroll: HTMLElement | null, viewRow: number, columnId: string): boolean {
  return findOwnCell(scroll, viewRow, columnId) !== null;
}

function waitForCell(engine: CommentEngine, scroll: HTMLElement | null, viewRow: number, ref: { rowId: string; columnId: string }, by: "keyboard" | "pointer" | "menu", frame: number): void {
  if (engine.isDisposed()) return;
  if (findCell(scroll, viewRow, ref.columnId)) {
    engine.store.open(ref, by);
    return;
  }
  if (frame >= OPEN_WAIT_FRAMES) {
    if (isDev()) console.warn("[data-grid-comments] openComments dropped: the cell did not render within 10 frames");
    return;
  }
  requestAnimationFrame(() => waitForCell(engine, scroll, viewRow, ref, by, frame + 1));
}

/** Scrolls to the cell, makes it active, and opens the popover once the cell renders. */
function openCell(
  engine: CommentEngine,
  api: DataGridApi<unknown>,
  scroll: HTMLElement | null,
  ref: { rowId: string; columnId: string },
  by: "keyboard" | "pointer" | "menu",
): boolean {
  const state = api.store.getState();
  if (!state.visibleColumns.some((c) => c.id === ref.columnId)) return false;
  const viewRow = api.getViewRowIds().indexOf(ref.rowId);
  if (viewRow < 0) return false;
  api.scrollTo(ref);
  api.actions.selectCell(ref);
  waitForCell(engine, scroll, viewRow, ref, by, 0);
  return true;
}

function assignReadOnly(state: { readOnly: boolean }, readOnly: boolean): void {
  state.readOnly = readOnly;
}

/** The plugin's Mount component: grid adapter, save-status watcher, announcer, popover host. */
export function createCommentsMount(engine: CommentEngine, getOptions: () => UseDataGridCommentsOptions): ComponentType {
  function CommentsMount(): ReactNode {
    const api = useDataGridApi();
    const scrollRef = useDataGridContainer();
    const readOnly = useDataGridReadOnly();
    const [gridState] = useState(() => ({ readOnly: false }));

    useEffect(() => {
      assignReadOnly(gridState, readOnly);
    }, [gridState, readOnly]);

    useEffect(() => {
      const adapter: GridAdapter = {
        readOnly: () => gridState.readOnly,
        saveStatus: (rowId) => api.store.getState().saveStatus.get(rowId),
        open: (ref, by) => openCell(engine, api, scrollRef.current, ref, by),
      };
      return engine.attachGrid(adapter);
    }, [api, scrollRef, gridState]);

    useEffect(() => {
      let previous = api.store.getState().saveStatus;
      return api.store.subscribe((s) => {
        if (s.saveStatus === previous) return;
        previous = s.saveStatus;
        engine.kickFetch();
      });
    }, [api]);

    return (
      <>
        <CommentPopoverHost engine={engine} getOptions={getOptions} />
        <Announcer engine={engine} getOptions={getOptions} />
      </>
    );
  }
  return CommentsMount;
}
