/** Deterministic LCG so SSR/CSR markup match without Math.random(); shared across example rows. */
function createSeededLcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export type DemoRow = {
  id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
  role: string;
  joined: string;
  score: number;
};

const ROLES = ["Admin", "User", "Editor", "Viewer", "Manager"] as const;
const ADJECTIVES = ["Eager", "Quick", "Silent", "Bold", "Swift"] as const;
const NOUNS = ["Eagle", "Lion", "Tiger", "Bear", "Wolf"] as const;

/** Generates `count` deterministic demo rows for example previews (seed 42, stable across renders). */
export function generateDemoRows(count: number, seed = 42): DemoRow[] {
  const next = createSeededLcg(seed);
  const rows: DemoRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      name: `${ADJECTIVES[Math.floor(next() * ADJECTIVES.length)]} ${NOUNS[Math.floor(next() * NOUNS.length)]}`,
      email: `user${i}@example.com`,
      age: Math.floor(next() * 50) + 18,
      active: next() > 0.5,
      role: ROLES[Math.floor(next() * ROLES.length)]!, // ROLES is a fixed non-empty literal array
      joined: `${2020 + Math.floor(next() * 5)}-${String(Math.floor(next() * 12) + 1).padStart(2, "0")}-${String(Math.floor(next() * 28) + 1).padStart(2, "0")}`,
      score: Math.floor(next() * 100),
    });
  }
  return rows;
}
