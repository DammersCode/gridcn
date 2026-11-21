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
const FIRST_NAMES = [
  "Ava", "Liam", "Mia", "Noah", "Priya", "Mateo", "Yuki", "Omar", "Elena", "Kofi",
  "Sofia", "Ravi", "Hannah", "Diego", "Amara", "Lukas", "Nadia", "Tomas", "Ingrid", "Jamal",
  "Chloe", "Arjun", "Fatima", "Ethan", "Leila", "Marco", "Zara", "Felix", "Mei", "Jonas",
  "Aisha", "Pavel", "Clara", "Hugo", "Nina", "Samir", "Alma", "Oskar", "Lucia", "Dev",
] as const;
const LAST_NAMES = [
  "Becker", "Okafor", "Nguyen", "Lindqvist", "Alvarez", "Tanaka", "Haddad", "Moreau", "Kowalski", "Patel",
  "Rossi", "Silva", "Novak", "Fischer", "Mensah", "Larsen", "Castillo", "Ivanov", "Yamamoto", "Duarte",
  "Brennan", "Hoffmann", "Santos", "Kaya", "Weber", "Adeyemi", "Petrov", "Lopez", "Chen", "Murphy",
  "Bianchi", "Haas", "Ito", "Reyes", "Sorensen", "Khan", "Costa", "Dubois", "Park", "Svensson",
] as const;

/**
 * Generates `count` deterministic rows of a fictional user directory (seed 42, stable across renders).
 * `score` is the number of logins in the last 30 days.
 */
export function generateDemoRows(count: number, seed = 42): DemoRow[] {
  const next = createSeededLcg(seed);
  const rows: DemoRow[] = [];
  const emailUses = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const first = FIRST_NAMES[Math.floor(next() * FIRST_NAMES.length)]!; // fixed non-empty literal arrays
    const last = LAST_NAMES[Math.floor(next() * LAST_NAMES.length)]!;
    const handle = `${first}.${last}`.toLowerCase();
    const uses = (emailUses.get(handle) ?? 0) + 1;
    emailUses.set(handle, uses);
    rows.push({
      id: `row-${i}`,
      name: `${first} ${last}`,
      email: `${handle}${uses > 1 ? uses : ""}@example.com`,
      age: Math.floor(next() * 44) + 21,
      active: next() > 0.5,
      role: ROLES[Math.floor(next() * ROLES.length)]!, // ROLES is a fixed non-empty literal array
      joined: `${2020 + Math.floor(next() * 5)}-${String(Math.floor(next() * 12) + 1).padStart(2, "0")}-${String(Math.floor(next() * 28) + 1).padStart(2, "0")}`,
      score: Math.floor(next() * 100),
    });
  }
  return rows;
}
