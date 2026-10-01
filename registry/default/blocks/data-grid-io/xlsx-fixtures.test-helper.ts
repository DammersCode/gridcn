import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { writeXlsx } from "hucre/xlsx";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ZipEntries = Map<string, Uint8Array>;

type ZipEntry = { name: string; method: number; data: Uint8Array };

/** Lists a zip archive's entries through its central directory; `data` is inflated. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip archive");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, method, data: method === 0 ? data : new Uint8Array(inflateRawSync(data)) });
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return entries;
}

/** Zip quirks a hostile file can use; each lists the entry names it applies to. */
export type ZipForgery = {
  /** Stored (method 0) instead of deflated. */
  stored?: string[];
  /** Sizes and crc live in a data descriptor; the local header holds zeros. */
  descriptor?: string[];
  /** The declared size is written to the central directory only; the local header keeps the real size. */
  centralOnly?: string[];
};

/** Writes entries as a deflated zip archive; `declaredSizes` overrides the uncompressed size an entry claims. */
function writeZip(entries: ZipEntries, declaredSizes: Record<string, number> = {}, forgery: ZipForgery = {}): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const stored = forgery.stored?.includes(name) ?? false;
    const descriptor = forgery.descriptor?.includes(name) ?? false;
    const compressed = stored ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const declaredSize = declaredSizes[name] ?? data.length;
    const localSize = forgery.centralOnly?.includes(name) ? data.length : declaredSize;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, descriptor ? 0x08 : 0, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, descriptor ? 0 : crc, true);
    lv.setUint32(18, descriptor ? 0 : compressed.length, true);
    lv.setUint32(22, descriptor ? 0 : localSize, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, descriptor ? 0x08 : 0, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, declaredSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    const trailer = new Uint8Array(descriptor ? 16 : 0);
    if (descriptor) {
      const tv = new DataView(trailer.buffer);
      tv.setUint32(0, 0x08074b50, true);
      tv.setUint32(4, crc, true);
      tv.setUint32(8, compressed.length, true);
      tv.setUint32(12, data.length, true);
    }
    locals.push(local, compressed, trailer);
    centrals.push(central);
    offset += local.length + compressed.length + trailer.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.size, true);
  ev.setUint16(10, entries.size, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + eocd.length);
  let at = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A real xlsx `File` written by hucre, one sheet per entry. */
export async function workbookFile(sheets: Record<string, unknown[][]>, name = "book.xlsx"): Promise<File> {
  const bytes = await writeXlsx({ sheets: Object.entries(sheets).map(([sheetName, rows]) => ({ name: sheetName, rows: rows as never })) });
  return new File([bytes.slice()], name, { type: XLSX_TYPE });
}

/** A copy of `file` with some zip entries replaced, e.g. a hand-written worksheet XML. */
export async function withEntries(
  file: File,
  replacements: Record<string, string | Uint8Array>,
  declaredSizes?: Record<string, number>,
  forgery?: ZipForgery,
): Promise<File> {
  const entries: ZipEntries = new Map(listZip(new Uint8Array(await file.arrayBuffer())).map((entry) => [entry.name, entry.data]));
  for (const [path, content] of Object.entries(replacements)) {
    entries.set(path, typeof content === "string" ? new TextEncoder().encode(content) : content);
  }
  return new File([writeZip(entries, declaredSizes, forgery)], file.name, { type: XLSX_TYPE });
}

/** Wraps `<sheetData>` rows in a minimal worksheet document. */
export function worksheetXml(sheetData: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
}

/** One inline-string cell at `ref` (e.g. "B3"). */
export function inlineCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
}

/** A one-sheet xlsx whose worksheet is `sheetXml`, padded with `padBytes` spaces inside `<sheetData>`; `declaredSize` makes the worksheet entry lie about its size. */
export async function xlsxWithWorksheet(sheetXml: string, padBytes = 0, declaredSize?: number): Promise<File> {
  const base = await workbookFile({ Sheet1: [["a"]] });
  if (padBytes === 0) return withEntries(base, { "xl/worksheets/sheet1.xml": sheetXml });
  const [head, tail] = sheetXml.split("<sheetData>") as [string, string];
  const prefix = new TextEncoder().encode(`${head}<sheetData>`);
  const suffix = new TextEncoder().encode(tail);
  const padded = new Uint8Array(prefix.length + padBytes + suffix.length).fill(0x20);
  padded.set(prefix, 0);
  padded.set(suffix, prefix.length + padBytes);
  return withEntries(base, { "xl/worksheets/sheet1.xml": padded }, declaredSize === undefined ? undefined : { "xl/worksheets/sheet1.xml": declaredSize });
}
