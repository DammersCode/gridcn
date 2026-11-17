"use client";

import { useEffect, useState } from "react";
import type { DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { createCommentEngine, type CommentEngine } from "./comment-engine";
import { createCommentsMount } from "./comments-mount";
import { createCommentsOverlay } from "./comments-overlay";
import { sameRecord } from "./comment-state";
import { commentMenuItems, createMenuItemsResolver } from "./menu-items";
import type { CellComment, UseDataGridCommentsOptions, UseDataGridCommentsResult } from "./types";

const RENDER_OPTION_KEYS = ["hideResolved", "labels", "className", "allowWhenReadOnly", "readOnly", "enableResolve", "enableEdit", "enableDelete", "canEdit", "canDelete", "canResolve", "canCreate", "fetchComments"] as const;

function renderOptionsChanged(previous: UseDataGridCommentsOptions, next: UseDataGridCommentsOptions): boolean {
  if (previous.currentUser?.id !== next.currentUser?.id || previous.currentUser?.name !== next.currentUser?.name || previous.currentUser?.color !== next.currentUser?.color) return true;
  return RENDER_OPTION_KEYS.some((key) => previous[key] !== next[key]);
}

type Instance = {
  engine: CommentEngine;
  /** The latest options and the last controlled prop; written in an effect, read by callbacks. */
  live: { options: UseDataGridCommentsOptions; prop: UseDataGridCommentsOptions["comments"] };
  result: UseDataGridCommentsResult;
  seeded: boolean;
};

type Live = Instance["live"];

function plainSeed(seed: UseDataGridCommentsOptions["defaultComments"]): readonly CellComment[] | undefined {
  return typeof seed === "function" ? undefined : seed;
}

/** A function seed runs once on the client after mount, so a seed that reads `localStorage` matches the server render; a throw starts the comments empty. */
function readFunctionSeed(seed: UseDataGridCommentsOptions["defaultComments"]): readonly CellComment[] | undefined {
  if (typeof seed !== "function") return undefined;
  try {
    return seed();
  } catch (error) {
    if (isDev()) console.warn(`[data-grid-comments] defaultComments threw, so the comments start empty: ${String(error)}`);
    return undefined;
  }
}

function seedOnce(instance: Instance, seed: UseDataGridCommentsOptions["defaultComments"]): void {
  if (instance.seeded) return;
  instance.seeded = true;
  const records = readFunctionSeed(seed);
  if (records) instance.engine.seed(records);
}

function assignOptions(live: Live, options: UseDataGridCommentsOptions): UseDataGridCommentsOptions {
  const previous = live.options;
  live.options = options;
  return previous;
}

function sameComments(a: UseDataGridCommentsOptions["comments"], b: UseDataGridCommentsOptions["comments"]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  try {
    return a.every((record, i) => sameRecord(record, b[i]!));
  } catch {
    return false;
  }
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
    initialComments: options.comments ?? plainSeed(options.defaultComments),
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
    cellMenuItems: (ctx) => commentMenuItems(engine, ctx),
  };
  const result: UseDataGridCommentsResult = {
    plugin,
    applyRemote: engine.applyRemote,
    getComments: engine.getComments,
    removeComments: (target) => engine.removeComments(target.rowIds),
    refetchComments: (target) => engine.refetch(target?.rowIds),
    openComments: (ref) => engine.openComments(ref, "keyboard"),
    closeComments: () => engine.store.close(),
    getCommentMenuItems: createMenuItemsResolver(engine),
  };
  return { engine, live, result, seeded: false };
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
    if (options.comments !== undefined && !sameComments(options.comments, live.prop)) {
      assignProp(live, options.comments);
      engine.syncProp(options.comments);
    }
  });

  useEffect(() => {
    seedOnce(instance, options.defaultComments);
    engine.start();
    return () => engine.dispose();
  }, [engine, instance]);

  return instance.result;
}
