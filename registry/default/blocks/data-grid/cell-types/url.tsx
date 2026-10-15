import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { TEXT_FILTER_OPERATORS } from "./capabilities";
import { safeHref } from "./safe-href";
import { displayText } from "./display-text";
import { useCellEditor } from "../interaction/use-cell-editor";

// One window.open-style opening context for every cell link; the same attributes the `openLink`
// action passes to window.open.
const LINK_OPEN_ATTRIBUTES = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
  referrerPolicy: "no-referrer",
} as const;

function UrlCell({ value, options }: CellRenderProps<unknown, string | null, GridCellTypes["url"]["options"]>) {
  const text = displayText(urlCellType, value, options);
  const href = urlCellType.href?.(value, options) ?? null;
  if (href === null) return <CellSpan text={text} />;
  // Not a tab stop: grid focus is roving (one focusable cell); alt+Enter (openLink) opens the active link.
  return (
    <a href={href} tabIndex={-1} draggable={false} {...LINK_OPEN_ATTRIBUTES} className="block w-full truncate text-primary underline">
      <bdi>{text}</bdi>
    </a>
  );
}

function UrlEditor(props: CellEditorProps<unknown, string | null, GridCellTypes["url"]["options"]>) {
  const { ref, ...bindings } = useCellEditor(props, { toDraft: urlCellType.toText, toValue: urlCellType.fromText });
  return <Input ref={ref} {...bindings} className="h-full w-full border-none bg-transparent p-0 shadow-none outline-none focus-visible:ring-0" />;
}

/** `url`: the stored value IS the URL — toText/copy/export/edit stay the URL; a value failing the safeHref allow-list renders as plain text. `options.label` maps the URL to the shown link text only. */
export const urlCellType: CellType<unknown, string | null, GridCellTypes["url"]["options"]> = {
  Cell: UrlCell,
  Editor: UrlEditor,
  filter: { operators: TEXT_FILTER_OPERATORS, valueInput: "text" },
  toText: (value) => String(value ?? "").trim(),
  toDisplayText: (value, options) => {
    const url = String(value ?? "").trim();
    return options?.label ? options.label(url) : url;
  },
  href: (value) => {
    const url = String(value ?? "").trim();
    return url === "" ? null : safeHref(url);
  },
  fromText: (text) => text.trim(),
  clearValue: () => null,
  isEmpty: (value) => value == null || value === "",
  compare: (a, b) => (a ?? "").localeCompare(b ?? ""),
};
