import { createHmac } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";

export const POSTGREST_URL = process.env["POSTGREST_URL"];
const JWT_SECRET = process.env["POSTGREST_JWT_SECRET"];
export const live = Boolean(POSTGREST_URL && JWT_SECRET);
if (!live && process.env["CI"] === "true") throw new Error("POSTGREST_URL and POSTGREST_JWT_SECRET must be set: in CI the postgrest project runs against a live PostgREST");

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(claims: Record<string, unknown>): string {
  const unsigned = `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url({ ...claims, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${unsigned}.${createHmac("sha256", JWT_SECRET!).update(unsigned).digest("base64url")}`;
}

/** A client signed in as `tenant`, or the anon role without one. */
export const client = (tenant?: number) => new PostgrestClient(POSTGREST_URL!, { retry: false, headers: tenant === undefined ? {} : { Authorization: `Bearer ${jwt({ role: "authenticated", tenant })}` } });

/** Every request over REST where it fits, or every request in the grid function. */
export const VIA = { rest: {}, rpc: { maxUrlLength: 1 } } as const;
