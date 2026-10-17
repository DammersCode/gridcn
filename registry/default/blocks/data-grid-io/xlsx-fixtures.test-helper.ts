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
const BIFF_JUNK = 0x1234;
const SECTOR = 512;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;

function biffBof(substream: "globals" | "worksheet", dataLength = 16, version = 0x600): Uint8Array {
  const data = new Uint8Array(dataLength);
  const view = new DataView(data.buffer);
  if (dataLength >= 2) view.setUint16(0, version, true);
  if (dataLength >= 4) view.setUint16(2, substream === "globals" ? 0x05 : 0x10, true);
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

function biffMulrk(row: number, firstCol: number, count: number, extraBytes: number): Uint8Array {
  const data = new Uint8Array(4 + count * 6 + 2 + extraBytes);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, firstCol, true);
  return biffRecord(BIFF_MULRK, data);
}

function biffBoundSheet(position: number, name: string): Uint8Array {
  const data = new Uint8Array(8 + name.length);
  new DataView(data.buffer).setUint32(0, position, true);
  data[6] = name.length;
  for (let i = 0; i < name.length; i++) data[8 + i] = name.charCodeAt(i);
  return biffRecord(BIFF_BOUNDSHEET, data);
}

type Ole2Stream = { name: string; data: Uint8Array; mini?: boolean };

/** Header and table edits a hostile OLE2 container can make, applied as the container is laid out. */
export type Ole2Forgery = {
  miniCutoff?: number;
  miniShift?: number;
  numFatSectors?: number;
  /** Extra header DIFAT entries, after the FAT sectors the container uses. */
  headerFatSectors?: number[];
  /** Overwrites FAT entries, `sector -> next`. */
  fatLinks?: Record<number, number>;
  /** Directory entries written as given, after the streams. */
  rawEntries?: { name: string; type: number; start: number; size: number }[];
  /** Size to declare for the Workbook stream instead of its real size. */
  workbookSize?: number;
  /** Adds a one-byte stream of this name whose sector chain loops on itself. */
  cycleStream?: string;
  /** Lists the FAT sectors in a DIFAT sector instead of the header. */
  difat?: boolean;
};

/** Lays streams out in a 512-byte-sector OLE2 container: FAT, directory, mini FAT and mini stream when any stream is mini, then regular streams padded to 4096 bytes. */
function writeOle2(streams: Ole2Stream[], forgery: Ole2Forgery = {}): Uint8Array<ArrayBuffer> {
  const regular = streams.filter((stream) => !stream.mini);
  const mini = streams.filter((stream) => stream.mini);
  const entryCount = 1 + streams.length + (forgery.rawEntries?.length ?? 0) + (forgery.cycleStream ? 1 : 0);
  const directorySectors = Math.ceil(entryCount / 4);
  const miniOffsets: number[] = [];
  let miniSize = 0;
  for (const stream of mini) {
    miniOffsets.push(miniSize / 64);
    miniSize += Math.ceil(stream.data.length / 64) * 64;
  }
  const miniFatSectors = mini.length > 0 ? 1 : 0;
  const miniStreamSectors = Math.ceil(miniSize / SECTOR);
  const regularSectors = regular.map((stream) => Math.max(8, Math.ceil(stream.data.length / SECTOR)));
  const dataSectors =
    directorySectors + miniFatSectors + miniStreamSectors + regularSectors.reduce((sum, count) => sum + count, 0) + (forgery.cycleStream ? 1 : 0) + (forgery.difat ? 1 : 0);
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < fatSectors + dataSectors) fatSectors++;
  const directoryAt = fatSectors;
  const miniFatAt = directoryAt + directorySectors;
  const miniStreamAt = miniFatAt + miniFatSectors;
  const regularAt: number[] = [];
  let next = miniStreamAt + miniStreamSectors;
  for (const count of regularSectors) {
    regularAt.push(next);
    next += count;
  }
  const cycleSector = forgery.cycleStream ? next++ : -1;
  const difatSector = forgery.difat ? next++ : -1;
  const out = new Uint8Array(SECTOR * (1 + next));
  const view = new DataView(out.buffer);
  const sectorOffset = (sector: number) => (sector + 1) * SECTOR;
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(24, 0x3e, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, forgery.miniShift ?? 6, true);
  view.setUint32(44, forgery.numFatSectors ?? fatSectors, true);
  view.setUint32(48, directoryAt, true);
  view.setUint32(56, forgery.miniCutoff ?? 4096, true);
  view.setUint32(60, mini.length > 0 ? miniFatAt : END_OF_CHAIN, true);
  view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, difatSector >= 0 ? difatSector : END_OF_CHAIN, true);
  view.setUint32(72, difatSector >= 0 ? 1 : 0, true);
  for (let i = 0; i < 109; i++) {
    const listed = i < fatSectors ? i : (forgery.headerFatSectors?.[i - fatSectors] ?? FREE_SECTOR);
    view.setUint32(76 + i * 4, difatSector >= 0 ? FREE_SECTOR : listed, true);
  }
  if (difatSector >= 0) {
    for (let i = 0; i < SECTOR / 4; i++) view.setUint32(sectorOffset(difatSector) + i * 4, i < fatSectors ? i : FREE_SECTOR, true);
    view.setUint32(sectorOffset(difatSector) + SECTOR - 4, END_OF_CHAIN, true);
  }
  for (let i = 0; i < (fatSectors * SECTOR) / 4; i++) view.setUint32(sectorOffset(0) + i * 4, FREE_SECTOR, true);
  const link = (sector: number, to: number) => view.setUint32(sectorOffset(0) + sector * 4, to, true);
  for (let i = 0; i < fatSectors; i++) link(i, 0xfffffffd);
  const chain = (start: number, count: number) => {
    for (let i = 0; i < count; i++) link(start + i, i === count - 1 ? END_OF_CHAIN : start + i + 1);
  };
  chain(directoryAt, directorySectors);
  if (miniFatSectors > 0) {
    chain(miniFatAt, 1);
    for (let i = 0; i < miniSize / 64; i++) view.setUint32(sectorOffset(miniFatAt) + i * 4, i + 1 < miniSize / 64 && !miniOffsets.includes(i + 1) ? i + 1 : END_OF_CHAIN, true);
  }
  if (miniStreamSectors > 0) chain(miniStreamAt, miniStreamSectors);
  regularSectors.forEach((count, i) => chain(regularAt[i]!, count));
  if (cycleSector >= 0) link(cycleSector, cycleSector);
  if (difatSector >= 0) link(difatSector, 0xfffffffc);
  for (const [sector, to] of Object.entries(forgery.fatLinks ?? {})) link(Number(sector), to);
  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    const at = sectorOffset(directoryAt) + index * 128;
    for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true);
    out[at + 66] = type;
    view.setUint32(at + 68, FREE_SECTOR, true);
    view.setUint32(at + 72, FREE_SECTOR, true);
    view.setUint32(at + 76, FREE_SECTOR, true);
    view.setUint32(at + 116, start, true);
    view.setUint32(at + 120, size, true);
  };
  entry(0, "Root Entry", 5, miniStreamSectors > 0 ? miniStreamAt : END_OF_CHAIN, miniSize);
  let index = 1;
  let regularIndex = 0;
  let miniIndex = 0;
  for (const stream of streams) {
    const declared = stream.name === "Workbook" ? forgery.workbookSize : undefined;
    if (stream.mini) {
      const at = miniOffsets[miniIndex]!;
      out.set(stream.data, sectorOffset(miniStreamAt) + at * 64);
      entry(index++, stream.name, 2, at, declared ?? stream.data.length);
      miniIndex++;
    } else {
      out.set(stream.data, sectorOffset(regularAt[regularIndex]!));
      entry(index++, stream.name, 2, regularAt[regularIndex]!, declared ?? regularSectors[regularIndex]! * SECTOR);
      regularIndex++;
    }
  }
  for (const raw of forgery.rawEntries ?? []) entry(index++, raw.name, raw.type, raw.start, raw.size);
  if (forgery.cycleStream) entry(index++, forgery.cycleStream, 2, cycleSector, 1);
  return out;
}

/** The last sector of a container written by {@link forgedXlsFile}; a hostile chain can point at it. */
export function lastForgedSector(file: File): number {
  return Math.floor(file.size / SECTOR) - 2;
}

type ForgedXlsOptions = {
  sheets: number;
  cell: { row: number; col: number };
  /** One cell per sheet, each in its own worksheet substream; overrides `sheets` and `cell`. */
  sheetCells?: { row: number; col: number }[];
  /** Write a MULRK record of this many cells starting at `cell`, instead of one number. */
  mulrkCount?: number;
  /** Bytes added to the MULRK record after its last cell. */
  mulrkExtraBytes?: number;
  /** Absolute stream offsets the sheets point at, in order; the worksheet substream when omitted. */
  sheetOffsets?: number[];
  /** Write a record before each worksheet BOF and point the sheets at it. */
  junkBeforeWorksheet?: boolean;
  /** Leave the worksheet without its EOF record. */
  unterminatedWorksheet?: boolean;
  /** Four-byte records written into the worksheet after its cell. */
  junkRecords?: number;
  /** Data length of the globals BOF record; 16 by default. */
  globalsBofLength?: number;
  /** Put the workbook in the mini stream. */
  mini?: boolean;
  /** Write a benign workbook under the same stream name ahead of the real one. */
  decoyWorkbook?: boolean;
  forgery?: Ole2Forgery;
  name?: string;
  version?: number;
};

/** Offsets of the BOUNDSHEET records of a forged workbook with `names`, for tests that point sheets at them. */
export function forgedBoundSheetOffsets(names: string[], globalsBofLength = 16): number[] {
  const offsets: number[] = [];
  let at = 4 + globalsBofLength;
  for (const name of names) {
    offsets.push(at);
    at += 12 + name.length;
  }
  return offsets;
}

function forgedWorkbookStream(options: ForgedXlsOptions): Uint8Array {
  const cells = options.sheetCells ?? Array.from({ length: options.sheets }, () => options.cell);
  const names = cells.map((_, i) => `S${i}`);
  const eof = biffRecord(BIFF_EOF, new Uint8Array(0));
  const bof = biffBof("globals", options.globalsBofLength, options.version);
  const globalsLength = bof.length + names.reduce((sum, name) => sum + biffBoundSheet(0, name).length, 0) + eof.length;
  const worksheets = cells.map((cell) =>
    concat([
      ...(options.junkBeforeWorksheet ? [biffRecord(BIFF_JUNK, new Uint8Array(2))] : []),
      biffBof("worksheet"),
      options.mulrkCount !== undefined ? biffMulrk(cell.row, cell.col, options.mulrkCount, options.mulrkExtraBytes ?? 0) : biffNumber(cell.row, cell.col),
      ...Array.from({ length: options.junkRecords ?? 0 }, () => biffRecord(BIFF_JUNK, new Uint8Array(0))),
      ...(options.unterminatedWorksheet ? [] : [eof]),
    ]),
  );
  const sharedWorksheet = options.sheetCells === undefined;
  const starts: number[] = [];
  let at = globalsLength;
  for (const worksheet of worksheets) {
    starts.push(at);
    if (!sharedWorksheet) at += worksheet.length;
  }
  const globals = concat([bof, ...names.map((name, i) => biffBoundSheet(options.sheetOffsets?.[i] ?? starts[i]!, name)), eof]);
  return concat([globals, ...(sharedWorksheet ? worksheets.slice(0, 1) : worksheets)]);
}

/** A forged BIFF8 `.xls`: by default every sheet points at one worksheet substream that holds one number, or one MULRK run, at `cell`. */
export function forgedXlsFile(options: ForgedXlsOptions): File {
  const streams: Ole2Stream[] = [];
  if (options.decoyWorkbook) streams.push({ name: "Workbook", data: forgedWorkbookStream({ sheets: 1, cell: { row: 0, col: 0 } }) });
  streams.push({ name: "Workbook", data: forgedWorkbookStream(options), mini: options.mini });
  return new File([writeOle2(streams, options.forgery)], options.name ?? "forged.xls", { type: "application/vnd.ms-excel" });
}
