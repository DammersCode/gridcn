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

// @babel/core 8 skips a component with a destructuring default; this probe keeps the compiler pass on Babel 7.
function ProbeDestructured({ items = [] }: { items?: { id: string; n: number }[] }) {
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

it(`compiles a component with a destructuring default: ${expectsMemoCache}`, () => {
  if (expectsMemoCache) expect(ProbeDestructured.toString()).toMatch(MEMO_CACHE);
  else expect(ProbeDestructured.toString()).not.toMatch(MEMO_CACHE);
});
