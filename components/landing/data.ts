import { gitConfig } from "@/lib/shared";

export const SUBLINE = "A data grid for React that feels like a spreadsheet and stays smooth at 100k rows.";

export const perfStats = [
  {
    value: "0.3–7.6 ms",
    title: "Streaming sort update",
    detail: "1 to 256 changed rows, one sort column, 100k rows. Production build.",
    source: "streaming updates",
    href: "/docs/streaming-updates",
  },
  {
    value: "51 ms",
    title: "Text sort",
    detail: "100k rows, down from 68 ms. In the browser.",
    source: "changelog",
    href: `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/CHANGELOG.md`,
  },
  {
    value: "16.8 ms",
    title: "Longest frame on jump scroll",
    detail: "Median over a jump sequence at 100k rows, down from 91.7 ms. Headless test. Frames over 33 ms: 4 to 0.",
    source: "performance guide",
    href: "/docs/performance",
  },
];

export const perfNote = "Your hardware and cells change these numbers.";

export const serverHighlights = [
  { title: "Lazy rows", text: "Row blocks load as you scroll. One hook, one fetch function.", href: "/docs/lazy-loading" },
  { title: "Server pagination", text: "Pages with or without a row count.", href: "/docs/pagination" },
  { title: "Server sort and filter", text: "The grid sends the sort and the filter groups; you answer with rows.", href: "/docs/sorting-filtering-search" },
  { title: "Saves with rollback", text: "onSave acknowledges or rejects each change. A rejected cell rolls back.", href: "/docs/recipes/data-fetching/server-round-trip" },
  { title: "Selection across pages", text: "Checked rows stay checked by id. Select all matching rows of the result.", href: "/docs/data-modes" },
  { title: "Filter values from the server", text: "The set filter lists values your backend returns.", href: "/docs/data-modes" },
];
