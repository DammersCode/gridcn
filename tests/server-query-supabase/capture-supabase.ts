import { PostgrestClient } from "@supabase/postgrest-js";

/** One request the client sent, as its `fetch` received it. */
export type SentRequest = { method: string; url: URL; headers: Record<string, string>; prefer?: string; rawBody?: string; body?: unknown; signal?: AbortSignal };
export type Result = { data: unknown; error: { message: string } | null; count: number | null };
export type Answer = (request: SentRequest) => Partial<Result> | undefined;

export const REST_URL = "https://project.supabase.co/rest/v1";

/** A real postgrest-js client whose `fetch` records each request and answers it from `answer`, without a network. */
export function captureSupabase(answer: Answer = () => undefined): { client: PostgrestClient; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const rawBody = typeof init.body === "string" ? init.body : undefined;
    const request: SentRequest = {
      method: init.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : String(input)),
      headers,
      prefer: headers["prefer"],
      rawBody,
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
      signal: init.signal ?? undefined,
    };
    sent.push(request);
    const result: Result = { data: request.method === "HEAD" ? null : [], error: null, count: null, ...answer(request) };
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const range: Record<string, string> = result.count === null ? {} : { "content-range": `*/${result.count}` };
    if (result.error) return Response.json(result.error, { status: 400 });
    return request.method === "HEAD" ? new Response(null, { headers: range }) : Response.json(result.data, { headers: range });
  };
  return { client: new PostgrestClient(REST_URL, { fetch, retry: false }), sent };
}

/** A client whose grid function calls run on `database`, as PostgREST's RPC would; with `maxUrlLength: 1`, every request is one. */
export function pgliteSupabase(database: { query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> }) {
  const rpc = (name: string, args: { plan: unknown }) => {
    const run = async () => {
      try {
        return { data: (await database.query<{ r: unknown }>(`select public.${name}($1::jsonb) as r`, [JSON.stringify(args.plan)])).rows[0]!.r, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    };
    // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
    const request = { then: (ok: (value: unknown) => unknown, fail: (reason: unknown) => unknown) => run().then(ok, fail), abortSignal: () => request };
    return request;
  };
  return { from: (relation: string) => captureSupabase().client.from(relation), rpc };
}
