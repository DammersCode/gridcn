function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(values);
  else for (let i = 0; i < bytes; i += 1) values[i] = Math.floor(Math.random() * 256);
  return Array.from(values, (v) => v.toString(16).padStart(2, "0")).join("");
}

/** `crypto.randomUUID` where it exists, a `getRandomValues` fallback on plain-http hosts. */
export function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return randomHex(16);
}

/** A write id generator: a random prefix per instance (drawn on the first write, never during render) plus a random suffix, so a peer cannot predict or forge an echo. */
export function createWriteIdGenerator(): () => string {
  let prefix: string | undefined;
  return () => {
    prefix ??= randomHex(6);
    return `${prefix}-${randomHex(8)}`;
  };
}
