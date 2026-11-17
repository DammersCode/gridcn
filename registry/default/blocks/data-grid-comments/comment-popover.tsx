"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDataGridApi, useDataGridReadOnly } from "@/registry/default/blocks/data-grid/data-grid";
import { GRID_ATTR, isComposingKey, rowIdAtViewRow, toSafeText, useDataGridContainer } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { cellComments, editDraftKey, newDraftKey } from "./comment-state";
import { authorLabelName, defaultCanModify } from "./default-gate";
import type { CommentEngine, WriteResult } from "./comment-engine";
import { resolveCommentsLabels, type DataGridCommentsLabels } from "./labels";
import type { CellComment, UseDataGridCommentsOptions } from "./types";

const FALLBACK_COLOR = "var(--color-primary)";

function safeColor(color: string | undefined): string {
  if (!color) return FALLBACK_COLOR;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return color;
  return CSS.supports("color", color) ? color : FALLBACK_COLOR;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button, textarea, input, [href], [tabindex]:not([tabindex='-1'])")).filter(
    (el) => el.getAttribute("aria-disabled") !== "true" && !(el as HTMLButtonElement).disabled,
  );
}

type Locate = () => HTMLElement | null;
type Holder<T> = { current: T };

function setHolder<T>(holder: Holder<T>, value: T): void {
  holder.current = value;
}

/** The cell's rect, or the last known one while the cell is out of the rendered rows. */
function rectOf(cell: HTMLElement | null, last: Holder<DOMRect | null>): DOMRect {
  if (cell) last.current = cell.getBoundingClientRect();
  return last.current ?? new DOMRect();
}

/** A mutable holder that is not a React ref: popup and field elements are read by event handlers and Base UI callbacks, never during render. */
function useHolder<T>(initial: T): Holder<T> {
  return useState(() => ({ current: initial }))[0];
}

/** Finds the rendered cell element of `{ rowId, columnId }`; the view row is cached and re-resolved when the store moved the row. */
function createCellAnchor(locate: Locate, getScroll: () => HTMLElement | null, last: Holder<DOMRect | null>) {
  return {
    get contextElement() {
      return getScroll() ?? undefined;
    },
    getBoundingClientRect: () => rectOf(locate(), last),
  };
}

function useLocateCell(rowId: string, columnId: string): Locate {
  const api = useDataGridApi();
  const scrollRef = useDataGridContainer();
  const viewRowCache = useHolder(-1);
  return useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return null;
    const state = api.store.getState();
    let viewRow = viewRowCache.current;
    if (viewRow < 0 || rowIdAtViewRow(state, viewRow) !== rowId) {
      viewRow = api.getViewRowIds().indexOf(rowId);
      setHolder(viewRowCache, viewRow);
    }
    if (viewRow < 0) return null;
    return scroll.querySelector<HTMLElement>(`[${GRID_ATTR.rowIndex}="${viewRow}"] [data-column-id="${CSS.escape(columnId)}"]`);
  }, [api, scrollRef, rowId, columnId, viewRowCache]);
}

/** The active row stays mounted off-window, so a mounted cell is not enough: it must also overlap the scrollport. */
function isCellInView(cell: HTMLElement | null, scroll: HTMLElement | null): boolean {
  if (!cell) return false;
  if (!scroll) return true;
  const c = cell.getBoundingClientRect();
  const v = scroll.getBoundingClientRect();
  return c.bottom > v.top && c.top < v.bottom && c.right > v.left && c.left < v.right;
}

type HostProps = { engine: CommentEngine; getOptions: () => UseDataGridCommentsOptions };

/** Mounts the popover for the open target. */
export function CommentPopoverHost({ engine, getOptions }: HostProps): ReactNode {
  const open = useStore(engine.store.ui, (s) => s.open);
  if (!open || typeof document === "undefined") return null;
  // portaled to the body: Base UI leaves an aria-owns span where it renders, and inside role="grid" that span fails the required-children rule
  return createPortal(<OpenPopover key={open.nonce} engine={engine} getOptions={getOptions} rowId={open.rowId} columnId={open.columnId} />, document.body);
}

function OpenPopover({ engine, getOptions, rowId, columnId }: HostProps & { rowId: string; columnId: string }): ReactNode {
  const api = useDataGridApi();
  const scrollRef = useDataGridContainer();
  const locate = useLocateCell(rowId, columnId);
  const getScroll = useCallback(() => scrollRef.current, [scrollRef]);
  const popupEl = useHolder<HTMLDivElement | null>(null);
  const composerEl = useHolder<HTMLTextAreaElement | null>(null);
  const escapeFn = useHolder<(() => boolean) | null>(null);
  const lastRect = useHolder<DOMRect | null>(null);
  const options = getOptions();
  const labels = resolveCommentsLabels(options.labels);

  // a function anchor: Base UI builds the virtual element outside render, where it reads the scroll element
  const anchor = useCallback(() => createCellAnchor(locate, getScroll, lastRect), [locate, getScroll, lastRect]);

  const closeWithFocusGrid = useCallback(
    (reason: "scroll-out" | "tab") => {
      const popup = popupEl.current;
      const hadFocus = popup !== null && popup.contains(document.activeElement);
      engine.store.close();
      if (!hadFocus) return;
      if (reason === "tab") api.focus();
      else scrollRef.current?.focus({ preventScroll: true });
    },
    [api, engine, scrollRef, popupEl],
  );

  useEffect(() => {
    const scroll = scrollRef.current;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      if (!isCellInView(locate(), scroll)) closeWithFocusGrid("scroll-out");
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(check);
    };
    scroll?.addEventListener("scroll", schedule, { passive: true });
    const unsubscribe = api.store.subscribe(schedule);
    schedule();
    return () => {
      scroll?.removeEventListener("scroll", schedule);
      unsubscribe();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [api, closeWithFocusGrid, locate, scrollRef]);

  const columnTitle = useMemo(() => {
    const column = api.store.getState().visibleColumns.find((c) => c.id === columnId);
    if (!column) return columnId;
    return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
  }, [api, columnId]);
  const [cellText, setCellText] = useState("");
  useEffect(() => {
    setCellText((locate()?.textContent ?? "").trim().slice(0, 60));
  }, [locate]);

  return (
    <PopoverPrimitive.Root
      open
      modal={false}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "escape-key" && escapeFn.current?.()) {
          details.cancel();
          return;
        }
        engine.store.close();
      }}
    >
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner anchor={anchor} side="bottom" align="start" sideOffset={4} className="isolate z-50">
          <PopoverPrimitive.Popup
            ref={popupEl}
            tabIndex={-1}
            aria-label={labels.popover(columnTitle, cellText)}
            {...{ [GRID_ATTR.commentsPopup]: "", [GRID_ATTR.keepFocus]: "" }}
            initialFocus={() => (cellComments(engine.store.core, rowId, columnId).length === 0 ? (composerEl.current ?? popupEl.current) : popupEl.current)}
            finalFocus={() => {
              const active = document.activeElement;
              const free = !active || active === document.body || popupEl.current?.contains(active) === true;
              if (free) api.focus();
              return false;
            }}
            onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key !== "Tab" || isComposingKey(event)) return;
              const popup = popupEl.current;
              if (!popup) return;
              const items = focusableIn(popup);
              const first = items[0];
              const last = items[items.length - 1];
              const active = document.activeElement;
              if ((event.shiftKey && (active === first || active === popup)) || (!event.shiftKey && active === last)) closeWithFocusGrid("tab");
            }}
            className={cn(
              "z-50 flex max-h-96 w-80 origin-(--transform-origin) flex-col gap-2.5 overflow-y-auto rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              options.className,
            )}
          >
            <PopoverBody engine={engine} getOptions={getOptions} rowId={rowId} columnId={columnId} labels={labels} composerEl={composerEl} escapeFn={escapeFn} />
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

type BodyProps = {
  engine: CommentEngine;
  getOptions: () => UseDataGridCommentsOptions;
  rowId: string;
  columnId: string;
  labels: DataGridCommentsLabels;
  composerEl: Holder<HTMLTextAreaElement | null>;
  escapeFn: Holder<(() => boolean) | null>;
};

function noticeFor(result: WriteResult, labels: DataGridCommentsLabels): string {
  if (result.ok) return "";
  switch (result.reason) {
    case "forbidden":
      return labels.refused;
    case "row-busy":
      return labels.rowBusyHint;
    case "read-only":
      return labels.readOnlyHint;
    case "pending":
      return "";
    default:
      return labels.failed;
  }
}

function formatTime(ts: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

/** The add-on state is mutable; both revisions are inputs here so the compiler re-reads it when either moves. */
function readBody(engine: CommentEngine, getOptions: () => UseDataGridCommentsOptions, rowId: string, columnId: string, revision: number, draftRevision: number) {
  return {
    options: getOptions(),
    user: engine.currentUser(),
    entries: cellComments(engine.store.core, rowId, columnId),
    fetchState: engine.fetchState(rowId),
    busy: engine.isRowBusy(rowId),
    stamp: revision + draftRevision,
  };
}

function readDraft(core: CommentEngine["store"]["core"], key: string, draftRevision: number) {
  return draftRevision < 0 ? undefined : core.drafts.get(key);
}

function findComposeConflict(core: CommentEngine["store"]["core"], rowId: string, columnId: string, draftRevision: number) {
  if (draftRevision < 0) return undefined;
  return Array.from(core.conflicts.values()).find((c) => c.rowId === rowId && c.columnId === columnId && (c.action === "create" || !core.confirmed.has(c.id)));
}

function PopoverBody({ engine, getOptions, rowId, columnId, labels, composerEl, escapeFn }: BodyProps): ReactNode {
  const revision = useStore(engine.store.ui, (s) => s.revision);
  const draftRevision = useStore(engine.store.ui, (s) => s.draftRevision);
  const core = engine.store.core;
  const gridReadOnly = useDataGridReadOnly();
  const { options, user, entries, fetchState, busy } = readBody(engine, getOptions, rowId, columnId, revision, draftRevision);
  const writable = user.kind !== "invalid" && options.readOnly !== true && (!gridReadOnly || options.allowWhenReadOnly === true);
  const currentUser = user.kind === "user" ? user.user : undefined;
  const resolveEnabled = options.enableResolve !== false;
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const composeKey = newDraftKey(rowId, columnId);
  const composeDraft = readDraft(core, composeKey, draftRevision);
  const composeConflict = findComposeConflict(core, rowId, columnId, draftRevision);
  const rootEl = useHolder<HTMLDivElement | null>(null);
  const focusedInside = useHolder(false);

  useEffect(() => {
    setHolder(escapeFn, () => {
      if (confirmId === null) return false;
      setConfirmId(null);
      return true;
    });
    return () => setHolder(escapeFn, null);
  }, [confirmId, escapeFn]);

  useEffect(() => {
    const popup = rootEl.current?.closest<HTMLElement>(`[${GRID_ATTR.commentsPopup}]`) ?? null;
    if (confirmId !== null) rootEl.current?.querySelector<HTMLElement>("[data-comment-confirm]")?.focus();
    else if (focusedInside.current && (!document.activeElement || document.activeElement === document.body)) popup?.focus();
  }, [confirmId, rootEl, focusedInside]);

  useEffect(() => {
    if (!focusedInside.current) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    rootEl.current?.closest<HTMLElement>(`[${GRID_ATTR.commentsPopup}]`)?.focus();
  });

  const run = async (promise: Promise<WriteResult>): Promise<void> => {
    const result = await promise;
    setNotice(noticeFor(result, labels));
  };

  const submitCompose = (): void => {
    const text = composeDraft?.text ?? "";
    if (!text.trim()) return;
    void run(engine.create({ rowId, columnId, text })).then(() => composerEl.current?.focus());
  };

  const hasCustomGate = (name: "canEdit" | "canDelete"): boolean => options[name] !== undefined;
  const canShowEdit = (c: CellComment): boolean => writable && (hasCustomGate("canEdit") || defaultCanModify(c, currentUser));
  const canShowDelete = (c: CellComment): boolean => writable && (hasCustomGate("canDelete") || defaultCanModify(c, currentUser));
  const max = engine.bounds().maxTextLength;
  const anySaving = entries.some((e) => e.saving);

  return (
    <div
      ref={rootEl}
      className="flex flex-col gap-2"
      aria-busy={anySaving || undefined}
      onFocusCapture={() => setHolder(focusedInside, true)}
    >
      {fetchState === "loading" || fetchState === "idle" ? (
        <p role="status" aria-live="polite" className="text-muted-foreground">
          {labels.loading}
        </p>
      ) : null}
      {fetchState === "failed" ? (
        <div role="alert" className="flex items-center justify-between gap-2">
          <span>{labels.loadFailed}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => engine.retryFetch(rowId)}>
            {labels.retry}
          </Button>
        </div>
      ) : null}
      {entries.length === 0 && fetchState === "ready" ? <p className="text-muted-foreground">{labels.noComments}</p> : null}
      {entries.length > 0 ? (
        <ul role="list" aria-label={labels.commentList} className="flex flex-col gap-2">
          {entries.map(({ comment, saving }, index) => {
            const time = formatTime(comment.createdAt, labels.locale);
            const name = authorLabelName(comment.author, labels.unknownAuthor);
            const editDraft = core.drafts.get(editDraftKey(comment.id));
            const conflict = core.conflicts.get(comment.id);
            const disabled = saving;
            return (
              <li key={comment.id} className="flex flex-col gap-1.5">
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {comment.author ? (
                    <>
                      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: safeColor(comment.author.color) }} />
                      <bdi className="font-medium text-foreground">{name}</bdi>
                    </>
                  ) : null}
                  <time dateTime={new Date(comment.createdAt).toISOString()}>{time}</time>
                  {resolveEnabled && comment.resolved ? <span>{labels.resolved}</span> : null}
                  {saving ? <span role="status">{labels.saving}</span> : null}
                </div>
                {editDraft ? (
                  <EditBox
                    engine={engine}
                    comment={comment}
                    text={editDraft.text}
                    base={{ version: editDraft.baseVersion, writeId: editDraft.baseWriteId }}
                    labels={labels}
                    max={max}
                    disabled={disabled}
                    onResult={(result) => setNotice(noticeFor(result, labels))}
                  />
                ) : (
                  <p className="text-sm">
                    <bdi className="whitespace-pre-wrap [overflow-wrap:anywhere]">{toSafeText(comment.text)}</bdi>
                  </p>
                )}
                {conflict ? <ConflictBox engine={engine} conflictId={comment.id} labels={labels} onResult={(result) => setNotice(noticeFor(result, labels))} /> : null}
                {!editDraft ? (
                  <div className="flex flex-wrap gap-1">
                    {canShowEdit(comment) ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-disabled={disabled || undefined}
                        aria-label={labels.edit(name, time)}
                        onClick={() => {
                          if (disabled) return;
                          engine.setDraft({ kind: "edit", commentId: comment.id, rowId, columnId, text: comment.text, baseVersion: comment.version, baseWriteId: comment.writeId });
                        }}
                      >
                        {labels.editAction}
                      </Button>
                    ) : null}
                    {canShowDelete(comment) ? (
                      confirmId === comment.id ? (
                        <>
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            data-comment-confirm=""
                            aria-disabled={disabled || undefined}
                            aria-label={labels.confirmRemove(name, time)}
                            onClick={() => {
                              if (disabled) return;
                              setConfirmId(null);
                              void run(engine.remove(comment.id, { version: comment.version, writeId: comment.writeId }));
                            }}
                          >
                            {labels.confirmDeleteAction}
                          </Button>
                          <Button type="button" size="xs" variant="ghost" onClick={() => setConfirmId(null)}>
                            {labels.cancel}
                          </Button>
                        </>
                      ) : (
                        <Button type="button" size="xs" variant="ghost" aria-disabled={disabled || undefined} aria-label={labels.remove(name, time)} onClick={() => !disabled && setConfirmId(comment.id)}>
                          {labels.deleteAction}
                        </Button>
                      )
                    ) : null}
                    {writable && resolveEnabled ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-disabled={disabled || undefined}
                        aria-label={comment.resolved ? labels.reopen(name, time) : labels.resolve(name, time)}
                        onClick={() => !disabled && void run(engine.setResolved(comment.id, !comment.resolved, { version: comment.version, writeId: comment.writeId }))}
                      >
                        {comment.resolved ? labels.reopenAction : labels.resolveAction}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {notice ? (
        <p role="alert" className="text-destructive">
          {notice}
        </p>
      ) : null}
      {composeConflict ? <ConflictBox engine={engine} conflictId={composeConflict.id} labels={labels} onResult={(result) => setNotice(noticeFor(result, labels))} /> : null}
      {fetchState === "ready" ? (
        writable && !busy ? (
          <div className="flex flex-col gap-1.5">
            <Textarea
              ref={composerEl}
              aria-label={labels.composer}
              placeholder={labels.composerPlaceholder}
              maxLength={max}
              value={composeDraft?.text ?? ""}
              className="min-h-16"
              onChange={(event) => engine.setDraft({ kind: "new", rowId, columnId, text: event.target.value, baseVersion: 0, baseWriteId: undefined })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !isComposingKey(event)) {
                  event.preventDefault();
                  submitCompose();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{(composeDraft?.text.length ?? 0) > max * 0.8 ? labels.counter(composeDraft?.text.length ?? 0, max) : ""}</span>
              <Button type="button" size="sm" onClick={submitCompose}>
                {labels.submit}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">{busy ? labels.rowBusyHint : labels.readOnlyHint}</p>
        )
      ) : null}
    </div>
  );
}

function EditBox({
  engine,
  comment,
  text,
  base,
  labels,
  max,
  disabled,
  onResult,
}: {
  engine: CommentEngine;
  comment: CellComment;
  text: string;
  base: { version: number; writeId: string | undefined };
  labels: DataGridCommentsLabels;
  max: number;
  disabled: boolean;
  onResult: (result: WriteResult) => void;
}): ReactNode {
  useStore(engine.store.ui, (s) => s.draftRevision);
  const submit = (): void => {
    if (disabled || !text.trim()) return;
    void engine.edit(comment.id, text, base).then(onResult);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        aria-label={labels.editComposer}
        maxLength={max}
        value={text}
        onChange={(event) => engine.setDraft({ kind: "edit", commentId: comment.id, rowId: comment.rowId, columnId: comment.columnId, text: event.target.value, baseVersion: base.version, baseWriteId: base.writeId })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !isComposingKey(event)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex gap-1">
        <Button type="button" size="xs" aria-disabled={disabled || undefined} onClick={submit}>
          {labels.save}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => engine.discardDraft(editDraftKey(comment.id))}>
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}

function ConflictBox({ engine, conflictId, labels, onResult }: { engine: CommentEngine; conflictId: string; labels: DataGridCommentsLabels; onResult: (result: WriteResult) => void }): ReactNode {
  const revision = useStore(engine.store.ui, (s) => s.draftRevision);
  const conflict = revision < 0 ? undefined : engine.store.core.conflicts.get(conflictId);
  if (!conflict) return null;
  const gone = conflict.action !== "create" && !engine.store.core.confirmed.has(conflict.id);
  const draftKey = conflict.action === "create" || gone ? newDraftKey(conflict.rowId, conflict.columnId) : editDraftKey(conflict.id);
  const draftText = engine.store.core.drafts.get(draftKey)?.text ?? conflict.text;
  const message = conflict.reason === "stale" ? labels.changedByOther : conflict.reason === "forbidden" ? labels.refused : labels.failed;
  return (
    <div role="alert" className="flex flex-col gap-1.5 text-destructive">
      <span>{conflict.message ?? message}</span>
      <div className="flex flex-wrap gap-1">
        {conflict.reason === "stale" && !conflict.discardOnly && !gone && conflict.text !== undefined ? (
          <Button type="button" size="xs" variant="outline" onClick={() => void engine.saveMine(conflict.id, draftText ?? "").then(onResult)}>
            {labels.saveMine}
          </Button>
        ) : null}
        {conflict.reason !== "stale" && conflict.reason !== "forbidden" ? (
          <Button type="button" size="xs" variant="outline" onClick={() => void engine.retry(conflict.id, draftText).then(onResult)}>
            {labels.retry}
          </Button>
        ) : null}
        <Button type="button" size="xs" variant="ghost" onClick={() => engine.discard(conflict.id)}>
          {labels.discard}
        </Button>
      </div>
    </div>
  );
}
