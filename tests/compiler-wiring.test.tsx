import { expect, it } from "vitest";
import { expectsMemoCache, MEMO_CACHE } from "./compiler-mode";

function Probe({ items }: { items: { id: string; n: number }[] }) {
  const total = items.reduce((a, b) => a + b.n, 0);
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.n}</li>
      ))}
      <b>{total}</b>
    </ul>
  );
}

it(`emits a memo cache: ${expectsMemoCache}`, () => {
  if (expectsMemoCache) expect(Probe.toString()).toMatch(MEMO_CACHE);
  else expect(Probe.toString()).not.toMatch(MEMO_CACHE);
});
