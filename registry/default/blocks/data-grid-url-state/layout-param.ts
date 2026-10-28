import type { ColumnLayout } from "@/registry/default/blocks/data-grid/data-grid";
import { safeDecode } from "./sort-param";

/** The parts of a {@link ColumnLayout} the URL can carry. */
export type UrlLayoutPart = "order" | "hidden" | "widths" | "pins";

/** Segments read from one layout param; a forged link cannot allocate past it. */
export const MAX_URL_LAYOUT_COLUMNS = 1024;

/** A layout param longer than this is ignored as a whole. */
export const MAX_URL_LAYOUT_PARAM_LENGTH = 16_384;

const NONE = "-";
const WIDTH_PATTERN = /^\d{1,5}$/;

function encodeId(id: string): string {
  return id === NONE ? "%2D" : encodeURIComponent(id);
}

function serializePair(id: string, value: string | number): string {
  return `${encodeId(id)}:${value}`;
}

/**
 * Compact URL encoding of one {@link ColumnLayout} part: `order` and `hidden` are comma-separated
 * column ids, `widths` is `id:px` pairs, `pins` is `id:s` / `id:e` pairs (start / end; the legacy
 * `l` / `r` codes are read, not written). Ids are percent-encoded.
 * An empty `hidden` or `pins` part is written as `-`.
 *
 * @example serializeLayoutPart("widths", { ...layout, widths: { name: 240 } }) // => "name:240"
 */
export function serializeLayoutPart(part: UrlLayoutPart, layout: ColumnLayout): string {
  switch (part) {
    case "order":
      return layout.order.map(encodeId).join(",");
    case "hidden":
      return layout.hidden.length === 0 ? NONE : layout.hidden.map(encodeId).join(",");
    case "widths":
      return Object.entries(layout.widths)
        .map(([id, width]) => serializePair(id, Math.round(width)))
        .join(",");
    case "pins": {
      const pins = Object.entries(layout.pins);
      return pins.length === 0 ? NONE : pins.map(([id, side]) => serializePair(id, side === "left" ? "s" : "e")).join(",");
    }
    default:
      return "";
  }
}

function decodeId(raw: string): string | null {
  const id = raw === "" ? null : safeDecode(raw);
  return id === "" ? null : id;
}

function parseIds(raw: string): string[] {
  const seen = new Set<string>();
  for (const segment of raw.split(",", MAX_URL_LAYOUT_COLUMNS)) {
    const id = decodeId(segment);
    if (id !== null) seen.add(id);
  }
  return [...seen];
}

function parsePairs<V>(raw: string, parseValue: (value: string) => V | null): [string, V][] {
  const seen = new Set<string>();
  const pairs: [string, V][] = [];
  for (const segment of raw.split(",", MAX_URL_LAYOUT_COLUMNS)) {
    const colon = segment.indexOf(":");
    if (colon < 0 || segment.indexOf(":", colon + 1) >= 0) continue;
    const id = decodeId(segment.slice(0, colon));
    if (id === null || seen.has(id)) continue;
    const value = parseValue(segment.slice(colon + 1));
    if (value === null) continue;
    seen.add(id);
    pairs.push([id, value]);
  }
  return pairs;
}

/**
 * Inverse of {@link serializeLayoutPart}. Returns only the given part, or `{}` when the param is
 * empty, longer than {@link MAX_URL_LAYOUT_PARAM_LENGTH}, or holds nothing valid. Reads at most
 * {@link MAX_URL_LAYOUT_COLUMNS} segments; undecodable, empty, and repeated ids and malformed values
 * are dropped (the first segment of an id wins). Never throws.
 *
 * @example parseLayoutPart("pins", "name:s,age:e") // => { pins: { name: "left", age: "right" } }
 */
export function parseLayoutPart(part: UrlLayoutPart, raw: string): Partial<ColumnLayout> {
  if (raw === "" || raw.length > MAX_URL_LAYOUT_PARAM_LENGTH) return {};
  switch (part) {
    case "order":
      return { order: parseIds(raw) };
    case "hidden":
      return { hidden: raw === NONE ? [] : parseIds(raw) };
    case "widths":
      return { widths: Object.fromEntries(parsePairs(raw, (v) => (WIDTH_PATTERN.test(v) ? Number(v) : null))) };
    case "pins":
      return {
        pins: Object.fromEntries(parsePairs(raw, (v) => (v === "l" || v === "s" ? "left" : v === "r" || v === "e" ? "right" : null))) as ColumnLayout["pins"],
      };
    default:
      return {};
  }
}
