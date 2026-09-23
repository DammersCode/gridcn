import type { RowMarkersContent, RowMarkersMode } from "../types";

/** True for the `reorder` family — the only modes that render the grip and arm the drag-to-reorder gesture. */
export function isReorderMarkerMode(mode: RowMarkersMode): boolean {
  return mode === "reorder" || mode.startsWith("reorder-");
}

/** The marker content a mode renders — the reorder family renders its suffix's content under the grip. */
export function markerContent(mode: RowMarkersMode): RowMarkersContent | "none" {
  switch (mode) {
    case "none":
    case "reorder":
      return "none";
    case "reorder-number":
      return "number";
    case "reorder-checkbox":
      return "checkbox";
    case "reorder-both":
      return "both";
    case "number":
    case "checkbox":
    case "both":
      return mode;
  }
}

/** Marker column px width per mode (number 44 / checkbox 36 / both 56 / reorder 32; the reorder family widens for the grip); 0 for 'none' (no track at all). */
export function markerWidth(mode: RowMarkersMode): number {
  switch (mode) {
    case "number":
      return 44;
    case "checkbox":
      return 36;
    case "both":
      return 56;
    case "reorder":
      return 32;
    case "reorder-number":
      return 56;
    case "reorder-checkbox":
      return 48;
    case "reorder-both":
      return 64;
    default:
      return 0;
  }
}
