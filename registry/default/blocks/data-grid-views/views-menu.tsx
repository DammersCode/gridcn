"use client";

import { useState, type KeyboardEvent } from "react";
import { Bookmark, Check, Pencil, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isComposingKey } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridViews, type ImportViewResult, type UseDataGridViewsOptions } from "./use-data-grid-views";
import { MAX_VIEW_NAME_LENGTH, type DataGridView } from "./view-state";

/** User-facing strings of {@link DataGridViews}. */
export type DataGridViewsLabels = {
  views: string;
  modified: string;
  loading: string;
  empty: string;
  loadFailed: string;
  saveFailed: string;
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
  importFailed: (reason: Extract<ImportViewResult, { ok: false }>["reason"]) => string;
};

export const DEFAULT_VIEWS_LABELS: DataGridViewsLabels = {
  views: "Views",
  modified: "Modified",
  loading: "Loading views…",
  empty: "No saved views yet.",
  loadFailed: "Saved views could not be loaded.",
  saveFailed: "Your last change could not be saved.",
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
  imported: (name, dropped) => (dropped > 0 ? `Imported view ${name}. ${dropped} entries for missing columns were left out.` : `Imported view ${name}`),
  exported: "Exported the active view as JSON below",
  importFailed: (reason) =>
    reason === "too-large" ? "The text is too long to be a view." : reason === "limit" ? "The view limit is reached." : reason === "loading" ? "Views are still loading." : "The text is not a valid view.",
};

/** Props for {@link DataGridViews}: the options of {@link useDataGridViews} plus styling. */
export type DataGridViewsProps = UseDataGridViewsOptions & {
  className?: string;
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
}: {
  view: DataGridView;
  active: boolean;
  isDefault: boolean;
  labels: DataGridViewsLabels;
  onSelect: () => void;
  onSetDefault: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(view.name);
  const [confirming, setConfirming] = useState(false);

  const commitRename = () => {
    setEditing(false);
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
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-1">
        <Input value={name} maxLength={MAX_VIEW_NAME_LENGTH} aria-label={labels.rename(view.name)} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} />
        <Button type="button" size="sm" onClick={commitRename}>
          {labels.confirmRename}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
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
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
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
  const [message, setMessage] = useState("");
  const { activeView } = views;

  const save = () => {
    const saved = views.saveView(newName);
    if (!saved) return;
    setNewName("");
    setMessage(labels.saved(saved.name));
  };
  const onSaveKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event) || event.key !== "Enter") return;
    event.preventDefault();
    save();
  };
  const runImport = () => {
    const result = views.importView(fileText);
    if (result.ok) {
      setFileText("");
      setMessage(labels.imported(result.view.name, result.dropped));
    } else {
      setMessage(labels.importFailed(result.reason));
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
      <PopoverContent align="start" className="w-80 gap-3 p-3">
        <div data-grid-views="" className="flex flex-col gap-3">
          {views.loading ? <p className="text-muted-foreground">{labels.loading}</p> : null}
          {views.error ? (
            <div role="alert" className="flex items-center justify-between gap-2 text-destructive">
              <span>{views.loading || views.views.length === 0 ? labels.loadFailed : labels.saveFailed}</span>
              <Button type="button" size="sm" variant="outline" onClick={views.retry}>
                {labels.retry}
              </Button>
            </div>
          ) : null}
          {!views.loading && views.views.length === 0 ? <p className="text-muted-foreground">{labels.empty}</p> : null}
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
                    setMessage(labels.applied(view.name));
                  }}
                  onSetDefault={() => views.setDefaultView(view.id === views.defaultViewId ? null : view.id)}
                  onRename={(name) => {
                    if (views.renameView(view.id, name)) setMessage(labels.renamed(name.trim()));
                  }}
                  onDelete={() => {
                    if (views.deleteView(view.id)) setMessage(labels.deleted(view.name));
                  }}
                />
              ))}
            </ul>
          ) : null}
          {activeView && views.modified ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (views.updateView()) setMessage(labels.updated(activeView.name));
              }}
            >
              {labels.updateActive(activeView.name)}
            </Button>
          ) : null}
          <div className="flex items-center gap-1">
            <Input value={newName} maxLength={MAX_VIEW_NAME_LENGTH} placeholder={labels.newViewName} aria-label={labels.newViewName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onSaveKeyDown} />
            <Button type="button" size="sm" disabled={newName.trim() === "" || views.loading} onClick={save}>
              {labels.saveNew}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <textarea
              value={fileText}
              onChange={(e) => setFileText(e.target.value)}
              aria-label={labels.fileLabel}
              spellCheck={false}
              rows={4}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeView}
                onClick={() => {
                  const text = views.exportView();
                  if (text === null) return;
                  setFileText(text);
                  setMessage(labels.exported);
                }}
              >
                {labels.exportView}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={fileText.trim() === ""} onClick={runImport}>
                {labels.importView}
              </Button>
            </div>
          </div>
          <p role="status" className="sr-only">
            {message}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
