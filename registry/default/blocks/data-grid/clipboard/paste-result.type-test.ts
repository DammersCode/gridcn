import type { PasteFromClipboardResult } from "../data-grid";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertEqual = <A, B>(_ok: Equal<A, B>) => {};

assertEqual<PasteFromClipboardResult, "ok" | "permission-denied" | "empty" | "refused">(true);
