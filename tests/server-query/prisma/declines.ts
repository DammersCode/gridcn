import { expect } from "vitest";
import type { Engine } from "../fixture";

type Decline = { engines: readonly Engine[]; match: RegExp; code: "unsupported" | "unsupported-value" | "limit-exceeded"; because: string };

const SQLITE: readonly Engine[] = ["sqlite"];
const BOTH: readonly Engine[] = ["sqlite", "pg"];

/**
 * The shared cases the Prisma adapter refuses by capability, by test name. Each one must reject with its code:
 * a listed case that passes fails, so the table stays exact.
 */
export const PRISMA_DECLINES: readonly Decline[] = [
  {
    engines: SQLITE,
    match: /^(name|tag) (equals|notEquals) (red|")|^not \((name|tag) (equals|notEquals)\)|^(or group|and of or groups|not \((and|or)\) over null cells|not group beside a row|not inside an or group|not of a not|or group beside an empty or group)$/,
    code: "unsupported",
    because: "SQLite `=` never folds case and Prisma has no `mode` there, so a case-insensitive equals has no exact form",
  },
  {
    engines: SQLITE,
    match: /^(name|tag) (isAnyOf|isNoneOf)( \["[^"].*\]| non-ASCII)?$|^not \(name (isAnyOf|isNoneOf)\)$/,
    code: "unsupported",
    because: "a case-insensitive set filter on SQLite has no exact form without `mode`",
  },
  {
    engines: SQLITE,
    match: /^root or: (two rows|a row and a group)$|^rowScope on a root or$|^groups of an empty result$/,
    code: "unsupported",
    because: "the root or holds a case-insensitive equals",
  },
  {
    engines: SQLITE,
    match: /^name (contains|endsWith) "(a_|%)"$|^hostile text: [%_]$/,
    code: "unsupported-value",
    because: "SQLite LIKE through Prisma has no ESCAPE clause, so % and _ stay wildcards",
  },
  {
    engines: SQLITE,
    match: /^two levels on a page of 1,000$/,
    code: "limit-exceeded",
    because: "the child groups of a page bind one key per requested group, and 1,000 keys pass the SQLite budget of 999",
  },
  {
    engines: BOTH,
    match: /^group level: a time column/,
    code: "unsupported",
    because: "Prisma reads DateTime in milliseconds, so a group key would miss microsecond rows",
  },
  {
    engines: BOTH,
    match: /^cursor sort: time/,
    code: "unsupported",
    because: "Prisma reads DateTime in milliseconds, so a microsecond cursor key would skip or repeat rows",
  },
  {
    engines: BOTH,
    match: /^every reducer per group$/,
    code: "unsupported",
    because: "count of text that folds '' into NULL needs NULLIF, which the object API lacks",
  },
  {
    engines: BOTH,
    match: /^a selection of 70,000 ids$/,
    code: "limit-exceeded",
    because: "Prisma binds one value per id and splits a longer `in` into chunks that merge wrong rows, so the adapter refuses past its budget",
  },
  {
    engines: BOTH,
    match: /^set values of tag$/,
    code: "unsupported",
    because: "groupBy keys cannot fold case, so set values need `caseSensitive` text",
  },
  {
    engines: BOTH,
    match: /^set values of createdAt$/,
    code: "unsupported",
    because: "groupBy has no day expression for a time column",
  },
];

export function prismaDecline(engine: Engine, name: string): Decline | undefined {
  return PRISMA_DECLINES.find((decline) => decline.engines.includes(engine) && decline.match.test(name));
}

/** Runs `call` and returns its answer, or asserts the declined refusal and returns `undefined` when the table lists `name`. */
export async function unlessDeclined<T>(adapter: string, engine: Engine, name: string, call: () => Promise<T>): Promise<T | undefined> {
  const decline = adapter === "prisma" ? prismaDecline(engine, name) : undefined;
  if (!decline) return call();
  await expect(call(), decline.because).rejects.toMatchObject({ code: decline.code });
  return undefined;
}
