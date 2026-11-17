import { readAnswer, type ServerRowsAnswer } from "./read-answer";
import { skeletonCount, startsSequence, stepSequence } from "./scroll-sequence";

/** The `initialAnswer` of scroll mode, read into the first render state; it stands for block 0 of the spec whose key it carries. */
export type ScrollSeed<TData, TCursor> = {
  specKey: string;
  /** The answer cut to one block, handed to the landing path. */
  answer: ServerRowsAnswer<TData, TCursor>;
  cut: boolean;
  rows: (TData | undefined)[];
  count: number | null;
  skeletons: number | null;
  loadedCount: number;
};

export function readScrollSeed<TData, TCursor>(initial: ServerRowsAnswer<TData, TCursor> | undefined, specKey: string, blockSize: number, source: "random" | "sequential" | undefined): ScrollSeed<TData, TCursor> | null {
  if (initial === undefined) return null;
  const range = { start: 0, end: blockSize };
  let read: ReturnType<typeof readAnswer<TData, TCursor>>;
  try {
    read = readAnswer<TData, TCursor>(initial, range, () => {});
  } catch {
    return null;
  }
  const cut = Array.isArray(initial.rows) && initial.rows.length > blockSize;
  const answer = { ...initial, rows: read.rows } as ServerRowsAnswer<TData, TCursor>;
  const sequence = source === "sequential" || (source !== "random" && startsSequence(read));
  if (!sequence) {
    const count = typeof read.totalRowCount === "number" ? read.totalRowCount : read.rows.length;
    const rows = new Array<TData | undefined>(count);
    const written = Math.min(read.rows.length, count);
    for (let index = 0; index < written; index++) rows[index] = read.rows[index];
    return { specKey, answer, cut, rows, count, skeletons: null, loadedCount: read.rows.slice(0, written).filter((row) => row !== undefined).length };
  }
  const sentCount = typeof read.totalRowCount === "number" ? read.totalRowCount : null;
  const loaded = read.rows.filter((row) => row !== undefined);
  const { ended } = stepSequence({ read, sentCursor: undefined, loaded: read.rows.length, count: sentCount, seenCursors: new Set() });
  const tail = skeletonCount({ loaded: read.rows.length, blockSize, count: sentCount, ended });
  const rows = [...loaded, ...new Array<undefined>(tail).fill(undefined)];
  return { specKey, answer, cut, rows, count: sentCount ?? (ended ? loaded.length : null), skeletons: tail, loadedCount: loaded.length };
}
