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

function biffRecord(id: number, data: Uint8Array): Uint8Array {
  const record = new Uint8Array(4 + data.length);
  const view = new DataView(record.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, data.length, true);
  record.set(data, 4);
  return record;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const BIFF_BOF = 0x809;
const BIFF_EOF = 0x0a;
const BIFF_BOUNDSHEET = 0x85;
const BIFF_NUMBER = 0x203;
const BIFF_MULRK = 0xbd;

function biffBof(substream: "globals" | "worksheet", version = 0x600): Uint8Array {
  const data = new Uint8Array(16);
  const view = new DataView(data.buffer);
  view.setUint16(0, version, true);
  view.setUint16(2, substream === "globals" ? 0x05 : 0x10, true);
  return biffRecord(BIFF_BOF, data);
}

function biffNumber(row: number, col: number): Uint8Array {
  const data = new Uint8Array(14);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, col, true);
  view.setFloat64(6, 1, true);
  return biffRecord(BIFF_NUMBER, data);
}

function biffMulrk(row: number, firstCol: number, count: number): Uint8Array {
  const data = new Uint8Array(4 + count * 6 + 2);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, firstCol, true);
  view.setUint16(data.length - 2, firstCol + count - 1, true);
  return biffRecord(BIFF_MULRK, data);
}

function biffBoundSheet(position: number, name: string): Uint8Array {
  const data = new Uint8Array(8 + name.length);
  new DataView(data.buffer).setUint32(0, position, true);
  data[6] = name.length;
  for (let i = 0; i < name.length; i++) data[8 + i] = name.charCodeAt(i);
  return biffRecord(BIFF_BOUNDSHEET, data);
}

/** Wraps `stream` as the `Workbook` stream of a 512-byte-sector OLE2 container, padded to the 4096-byte mini-stream cutoff. */
function writeOle2(stream: Uint8Array): Uint8Array<ArrayBuffer> {
  const sector = 512;
  const sectors = Math.max(8, Math.ceil(stream.length / sector));
  const END = 0xfffffffe;
  const FREE = 0xffffffff;
  const out = new Uint8Array(sector * (3 + sectors));
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, END, true);
  view.setUint32(68, END, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i === 0 ? 0 : FREE, true);
  const fat = sector;
  for (let i = 0; i < sector / 4; i++) view.setUint32(fat + i * 4, FREE, true);
  view.setUint32(fat, 0xfffffffd, true);
  view.setUint32(fat + 4, END, true);
  for (let i = 0; i < sectors; i++) view.setUint32(fat + (2 + i) * 4, i === sectors - 1 ? END : 3 + i, true);
  const directory = 2 * sector;
  const entry = (at: number, name: string, type: number, start: number, size: number) => {
    for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true);
    out[at + 66] = type;
    view.setUint32(at + 68, FREE, true);
    view.setUint32(at + 72, FREE, true);
    view.setUint32(at + 76, FREE, true);
    view.setUint32(at + 116, start, true);
    view.setUint32(at + 120, size, true);
  };
  entry(directory, "Root Entry", 5, END, 0);
  entry(directory + 128, "Workbook", 2, 2, sectors * sector);
  out.set(stream, 3 * sector);
  return out;
}

/** Byte length of the BIFF record that `forgedXlsFile` writes for the BOF, so a test can point a sheet at the records after it. */
export const FORGED_XLS_FIRST_RECORD_OFFSET = 20;

type ForgedXlsOptions = {
  sheets: number;
  cell: { row: number; col: number };
  /** Write a MULRK record of this many cells starting at `cell`, instead of one number. */
  mulrkCount?: number;
  /** Absolute stream offsets the sheets point at, in order; the worksheet substream when omitted. */
  sheetOffsets?: number[];
  /** Leave the worksheet without its EOF record. */
  unterminatedWorksheet?: boolean;
  name?: string;
  version?: number;
};

/** A forged BIFF8 `.xls`: every sheet name in `sheets` points at one worksheet substream that holds one number, or one MULRK run, at `cell`. */
export function forgedXlsFile(options: ForgedXlsOptions): File {
  const names = Array.from({ length: options.sheets }, (_, i) => `S${i}`);
  const eof = biffRecord(BIFF_EOF, new Uint8Array(0));
  const globalsLength = biffBof("globals").length + names.reduce((sum, name) => sum + biffBoundSheet(0, name).length, 0) + eof.length;
  const globals = concat([
    biffBof("globals", options.version),
    ...names.map((name, i) => biffBoundSheet(options.sheetOffsets?.[i] ?? globalsLength, name)),
    eof,
  ]);
  const cell = options.mulrkCount ? biffMulrk(options.cell.row, options.cell.col, options.mulrkCount) : biffNumber(options.cell.row, options.cell.col);
  const worksheet = concat([biffBof("worksheet"), cell, ...(options.unterminatedWorksheet ? [] : [eof])]);
  return new File([writeOle2(concat([globals, worksheet]))], options.name ?? "forged.xls", { type: "application/vnd.ms-excel" });
}
