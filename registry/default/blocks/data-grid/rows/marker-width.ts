import type { RowMarkersMode } from "../types";

/** Marker column px width per mode (44 number / 36 checkbox / 56 both / 32 reorder); 0 for 'none' (no track at all). */
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
    default:
      return 0;
  }
}
