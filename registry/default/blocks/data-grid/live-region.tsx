"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDataGridLabels, useDataGridLiveAnnouncement, useDataGridRowMoveAnnouncement, type LiveAnnouncement } from "./store";

/** Trailing pause before the region reads the latest announcement; a rapid run (marker range drag, fast filter edits) collapses into its last one. */
const ANNOUNCEMENT_DEBOUNCE_MS = 500;

export function LiveRegion(): ReactNode {
  const record = useDataGridLiveAnnouncement();
  const { grid } = useDataGridLabels();
  const rowMoveText = useDataGridRowMoveAnnouncement();
  const [shown, setShown] = useState<LiveAnnouncement | null>(null);
  // role="status" may not live inside role="grid" (axe aria-required-children), so the region portals to <body> after mount.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTarget(document.body);
  }, []);
  // Emptying the region first makes a repeated text read again.
  useEffect(() => {
    setShown(null);
    if (!record) return;
    const t = setTimeout(() => setShown(record), ANNOUNCEMENT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [record]);

  const text = shown && (shown.kind === "rowMove" ? rowMoveText : shown.kind === "rowsChecked" ? grid.rowsChecked(shown.count) : grid.resultsCount(shown.count));
  if (!target) return null;
  return createPortal(
    <div aria-live="polite" role="status" className="sr-only">
      {text}
    </div>,
    target,
  );
}
