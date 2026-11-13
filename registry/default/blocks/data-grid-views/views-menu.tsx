"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Bookmark, Check, Pencil, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { isComposingKey } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridViews, type ImportViewResult, type UseDataGridViewsOptions } from "./use-data-grid-views";
import { MAX_VIEWS, MAX_VIEW_FILE_LENGTH, MAX_VIEW_NAME_LENGTH, type DataGridView, type OverLimitPart } from "./view-state";

/** User-facing strings of {@link DataGridViews}. */
export type DataGridViewsLabels = {
  views: string;
  modified: string;
  loading: string;
  empty: string;
  loadFailed: string;
  saveFailed: string;
  limit: string;
  overLimit: (part: OverLimitPart) => string;
  importedName: string;
  retry: string;
  setDefault: (name: string) => string;
  unsetDefault: (name: string) => string;
  rename: (name: string) => string;
  delete: (name: string) => string;
  confirmDelete: (name: string) => string;
  newViewName: string;
  saveNew: string;
  updateActive: (name: string) => string;
  confirmRename: string;
  cancel: string;
  fileLabel: string;
  exportView: string;
  importView: string;
  saved: (name: string) => string;
  updated: (name: string) => string;
  renamed: (name: string) => string;
  deleted: (name: string) => string;
  applied: (name: string) => string;
  imported: (name: string, dropped: number) => string;
  exported: string;
  exportTooLarge: string;
  importFailed: (reason: Extract<ImportViewResult, { ok: false }>["reason"]) => string;
};

const OVER_LIMIT_LINES: Record<OverLimitPart, string> = {
  sorts: "The sorts are over the view limit of 16. Remove one to save the view.",
  filters: "The filters are over a view limit: 64 filters, 16 groups, 1,000 characters in a value, or 1,000 entries in a value list. Remove or shorten them to save the view.",
  search: "The search text is over the view limit of 500 characters. Shorten it to save the view.",
  layout: "The column layout is over a view limit: a column wider than 10,000 px or a layout list over 1,000 entries. Reset the layout to save the view.",
  columnId: "A column id is over the view limit of 200 characters, so a view cannot hold a sort, filter, or layout setting for that column. Remove those settings to save the view.",
};

export const DEFAULT_VIEWS_LABELS: DataGridViewsLabels = {
  views: "Views",
  modified: "Modified",
  loading: "Loading views…",
  empty: "No saved views yet.",
  loadFailed: "Saved views could not be loaded.",
  saveFailed: "Your last change could not be saved.",
  limit: `The limit of ${MAX_VIEWS} views is reached.`,
  overLimit: (part) => OVER_LIMIT_LINES[part],
  importedName: "Imported view",
  retry: "Retry",
  setDefault: (name) => `Use ${name} as the default view`,
  unsetDefault: (name) => `Stop using ${name} as the default view`,
  rename: (name) => `Rename ${name}`,
  delete: (name) => `Delete ${name}`,
  confirmDelete: (name) => `Confirm delete ${name}`,
  newViewName: "View name",
  saveNew: "Save as new view",
  updateActive: (name) => `Update ${name}`,
  confirmRename: "Save name",
  cancel: "Cancel",
  fileLabel: "View as JSON",
  exportView: "Export active view",
  importView: "Import view",
  saved: (name) => `Saved view ${name}`,
  updated: (name) => `Updated view ${name}`,
  renamed: (name) => `Renamed to ${name}`,
  deleted: (name) => `Deleted view ${name}`,
  applied: (name) => `Applied view ${name}`,
  imported: (name, dropped) => (dropped > 0 ? `Imported view ${name}. Left out because they do not fit this grid: ${dropped}.` : `Imported view ${name}`),
  exported: "Exported the active view as JSON below",
  exportTooLarge: "This view is too large to export as text.",
  importFailed: (reason) =>
    reason === "too-large" ? "The text is too long to be a view." : reason === "limit" ? "The view limit is reached." : reason === "loading" ? "Views are still loading." : "The text is not a valid view.",
};

/** Props for {@link DataGridViews}: the options of {@link useDataGridViews} plus styling. */
export type DataGridViewsProps = UseDataGridViewsOptions & {
  className?: string;
  /** Overrides for the menu's strings, merged key by key over the built-in English defaults. The grid's `labels` prop does not reach this menu. */
  labels?: Partial<DataGridViewsLabels>;
};

function ViewRow({
  view,
  active,
  isDefault,
  labels,
  onSelect,
  onSetDefault,
  onRename,
  onDelete,
  onAfterDelete,
}: {
  view: DataGridView;
  active: boolean;
  isDefault: boolean;
  labels: DataGridViewsLabels;
  onSelect: () => void;
  onSetDefault: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAfterDelete: () => void;
}) {
  const renameButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(view.name);
  const [confirming, setConfirming] = useState(false);

  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => renameButton.current?.focus());
  };
  const commitRename = () => {
    stopEditing();
    if (name.trim() !== "" && name.trim() !== view.name) onRename(name);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopEditing();
    }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1">
        <Input value={name} maxLength={MAX_VIEW_NAME_LENGTH} aria-label={labels.rename(view.name)} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />
        <Button type="button" size="sm" onClick={commitRename}>
          {labels.confirmRename}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={stopEditing}>
          {labels.cancel}
        </Button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1" data-active={active ? "" : undefined}>
      <Button type="button" variant={active ? "secondary" : "ghost"} size="sm" className="min-w-0 flex-1 justify-start" aria-current={active ? "true" : undefined} onClick={onSelect}>
        {active ? <Check /> : null}
        <span className="truncate">{view.name}</span>
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-pressed={isDefault} aria-label={isDefault ? labels.unsetDefault(view.name) : labels.setDefault(view.name)} onClick={onSetDefault}>
        <Star className={cn(isDefault && "fill-current")} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        ref={renameButton}
        aria-label={labels.rename(view.name)}
        onClick={() => {
          setName(view.name);
          setEditing(true);
        }}
      >
        <Pencil />
      </Button>
      <Button
        type="button"
        variant={confirming ? "destructive" : "ghost"}
        size="icon-sm"
        aria-label={confirming ? labels.confirmDelete(view.name) : labels.delete(view.name)}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) return setConfirming(true);
          onDelete();
          onAfterDelete();
        }}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

/**
 * Toolbar popover to pick, save, update, rename, delete, default, export, and import grid views.
 * Place it inside the grid provider, for example in `DataGridToolbar`. It takes the options of
 * {@link useDataGridViews}.
 */
export function DataGridViews({ className, labels: labelOverrides, ...options }: DataGridViewsProps) {
  const labels = { ...DEFAULT_VIEWS_LABELS, ...labelOverrides };
  const views = useDataGridViews(options);
  const [newName, setNewName] = useState("");
  const [fileText, setFileText] = useState("");
  const [message, setMessage] = useState({ text: "", id: 0 });
  const [problem, setProblem] = useState("");
  const nameField = useRef<HTMLInputElement>(null);
  const { activeView } = views;
  const announce = (text: string) => {
    setProblem("");
    setMessage((previous) => ({ text, id: previous.id + 1 }));
  };
  const fail = (text: string) => {
    setProblem(text);
    setMessage((previous) => ({ text, id: previous.id + 1 }));
  };
  const focusNameField = () => requestAnimationFrame(() => nameField.current?.focus());
  const atLimit = views.views.length >= MAX_VIEWS;
  const canSave = !views.loading && views.failed !== "load" && !atLimit && !views.overLimit && newName.trim() !== "";

  const save = () => {
    if (!canSave) return;
    const saved = views.saveView(newName);
    if (!saved) return;
    setNewName("");
    announce(labels.saved(saved.name));
  };
  const onSaveKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event) || event.key !== "Enter") return;
    event.preventDefault();
    save();
  };
  const runImport = () => {
    const result = views.importView(fileText, { name: labels.importedName });
    if (result.ok) {
      setFileText("");
      announce(labels.imported(result.view.name, result.dropped));
      focusNameField();
    } else {
      fail(labels.importFailed(result.reason));
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" className={cn("relative", className)} data-modified={views.modified ? "" : undefined}>
            <Bookmark />
            <span className="max-w-40 truncate">{activeView?.name ?? labels.views}</span>
            {views.modified ? <Badge variant="secondary">{labels.modified}</Badge> : null}
          </Button>
        }
      />
      <PopoverContent align="start" className="max-h-(--available-height) w-80 gap-3 overflow-y-auto p-3" aria-label={labels.views}>
        <div data-grid-views="" className="flex flex-col gap-3">
          {views.loading ? <p className="text-muted-foreground">{labels.loading}</p> : null}
          {views.failed ? (
            <div role="alert" className="flex items-center justify-between gap-2 text-destructive">
              <span>{views.failed === "load" ? labels.loadFailed : labels.saveFailed}</span>
              <Button type="button" size="sm" variant="outline" onClick={views.retry}>
                {labels.retry}
              </Button>
            </div>
          ) : null}
          {!views.loading && views.failed !== "load" && views.views.length === 0 ? <p className="text-muted-foreground">{labels.empty}</p> : null}
          {views.views.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label={labels.views}>
              {views.views.map((view) => (
                <ViewRow
                  key={view.id}
                  view={view}
                  active={view.id === views.activeViewId}
                  isDefault={view.id === views.defaultViewId}
                  labels={labels}
                  onSelect={() => {
                    views.selectView(view.id);
                    announce(labels.applied(view.name));
                  }}
                  onSetDefault={() => views.setDefaultView(view.id === views.defaultViewId ? null : view.id)}
                  onRename={(name) => {
                    if (views.renameView(view.id, name)) announce(labels.renamed(name.trim()));
                  }}
                  onDelete={() => {
                    if (views.deleteView(view.id)) announce(labels.deleted(view.name));
                  }}
                  onAfterDelete={focusNameField}
                />
              ))}
            </ul>
          ) : null}
          {activeView && views.modified ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={views.overLimit !== false}
              onClick={() => {
                if (views.updateView()) {
                  announce(labels.updated(activeView.name));
                  focusNameField();
                }
              }}
            >
              {labels.updateActive(activeView.name)}
            </Button>
          ) : null}
          <div className="flex items-center gap-1">
            <Input ref={nameField} value={newName} maxLength={MAX_VIEW_NAME_LENGTH} placeholder={labels.newViewName} aria-label={labels.newViewName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onSaveKeyDown} />
            <Button type="button" size="sm" disabled={!canSave} onClick={save}>
              {labels.saveNew}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Textarea
              value={fileText}
              onChange={(e) => setFileText(e.target.value)}
              maxLength={MAX_VIEW_FILE_LENGTH * 2}
              aria-label={labels.fileLabel}
              spellCheck={false}
              rows={4}
              className="max-h-40 resize-y font-mono text-xs"
            />
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeView}
                onClick={() => {
                  const text = views.exportView();
                  if (text === null) return fail(labels.exportTooLarge);
                  setFileText(text);
                  announce(labels.exported);
                }}
              >
                {labels.exportView}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={fileText.trim() === ""} onClick={runImport}>
                {labels.importView}
              </Button>
            </div>
          </div>
          {atLimit ? <p className="text-muted-foreground">{labels.limit}</p> : null}
          {views.overLimit ? <p className="text-muted-foreground">{labels.overLimit(views.overLimit)}</p> : null}
          {problem ? <p className="text-destructive">{problem}</p> : null}
          <p role="status" className="sr-only">
            {/* a trailing no-break space on every second message makes a repeated text change, so it is announced again */}
            {message.text}
            {message.id % 2 === 0 ? " " : ""}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
