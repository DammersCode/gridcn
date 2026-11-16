import type { HistorySkip, RecordedChange } from "./data-grid-history";

type Row = { id: string };

export const onSkip = (skip: HistorySkip): string => skip.reason;
export const change: RecordedChange<Row> = { ops: [] };
