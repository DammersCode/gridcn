"use client";

import { useEffect, useState } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { createCommentEngine, type CommentEngine } from "./comment-engine";
import { createCommentsMount } from "./comments-mount";
import { createCommentsOverlay } from "./comments-overlay";
import { createMenuItemsResolver } from "./menu-items";
import type { UseDataGridCommentsOptions, UseDataGridCommentsResult } from "./types";

const RENDER_OPTION_KEYS = ["hideResolved", "labels", "className", "allowWhenReadOnly", "readOnly", "enableResolve", "canEdit", "canDelete", "canResolve", "canCreate", "fetchComments"] as const;

function renderOptionsChanged(previous: UseDataGridCommentsOptions, next: UseDataGridCommentsOptions): boolean {
  if (previous.currentUser?.id !== next.currentUser?.id || previous.currentUser?.name !== next.currentUser?.name || previous.currentUser?.color !== next.currentUser?.color) return true;
  return RENDER_OPTION_KEYS.some((key) => previous[key] !== next[key]);
}

type Instance = {
  engine: CommentEngine;
  /** The latest options and the last controlled prop; written in an effect, read by callbacks. */
  live: { options: UseDataGridCommentsOptions; prop: UseDataGridCommentsOptions["comments"] };
  result: UseDataGridCommentsResult;
};

type Live = Instance["live"];

function assignOptions(live: Live, options: UseDataGridCommentsOptions): UseDataGridCommentsOptions {
  const previous = live.options;
  live.options = options;
  return previous;
}

function previousProp(live: Live): UseDataGridCommentsOptions["comments"] {
  return live.prop;
}

function assignProp(live: Live, prop: UseDataGridCommentsOptions["comments"]): void {
  live.prop = prop;
}

function createInstance(options: UseDataGridCommentsOptions): Instance {
  const live = { options, prop: options.comments };
  const getOptions = (): UseDataGridCommentsOptions => live.options;
  const engine = createCommentEngine({
    getOptions,
    controlled: options.comments !== undefined,
    initialComments: options.comments ?? options.defaultComments,
  });
  const plugin: DataGridPlugin = {
    name: "comments",
    Overlay: createCommentsOverlay(engine, getOptions),
    Mount: createCommentsMount(engine, getOptions),
    onDataChange: (next, change, ctx) => engine.observeDataChange(next, change, { getRowId: ctx.api.store.getState().getRowId }),
    commands: {
      openComments: {
        when: (ctx) => ctx.row !== undefined && ctx.cell !== null,
        run: (ctx) => {
          if (ctx.cell) engine.openComments(ctx.cell, "keyboard");
        },
      },
    },
    keymap: { openComments: ["shift+F2"] },
  };
  const result: UseDataGridCommentsResult = {
    plugin,
    applyRemote: engine.applyRemote,
    getComments: engine.getComments,
    removeComments: (target) => engine.removeComments(target.rowIds),
    refetchComments: (target) => engine.refetch(target?.rowIds),
    openComments: (ref) => engine.openComments(ref, "keyboard"),
    closeComments: () => engine.store.close(),
    getCommentMenuItems: createMenuItemsResolver(engine, getOptions),
  };
  return { engine, live, result };
}

/**
 * Cell comments as a single hook: markers, the comments popover, optimistic writes with versions,
 * and echo handling. The hook is called outside the provider; pass `plugin` to the grid's `plugins`.
 * The app owns transport and save (`onCommentSave`, `applyRemote`, `fetchComments`).
 */
export function useDataGridComments(options: UseDataGridCommentsOptions = {}): UseDataGridCommentsResult {
  const [instance] = useState(() => createInstance(options));
  const { engine, live } = instance;

  useEffect(() => {
    const previous = assignOptions(live, options);
    if (renderOptionsChanged(previous, options)) engine.store.bumpContent();
    if (options.comments !== undefined && options.comments !== previousProp(live)) {
      assignProp(live, options.comments);
      engine.syncProp(options.comments);
    }
  });

  useEffect(() => {
    engine.start();
    return () => engine.dispose();
  }, [engine]);

  return instance.result;
}
