import type { SupabaseClientLike } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";

/** One request the fake client would send. */
export type SentRequest = { method: "GET" | "HEAD" | "POST"; url: URL; prefer?: string; body?: unknown; signal?: AbortSignal };
export type Result = { data: unknown; error: { message: string } | null; count: number | null };
export type Answer = (request: SentRequest) => Partial<Result> | undefined;

export const REST_URL = "https://project.supabase.co/rest/v1";

/**
 * The URL behavior of postgrest-js (supabase-js `packages/core/postgrest-js`): `select` sets `select` with the whitespace
 * outside quotes removed, `or` appends `(filters)`, `order` extends `order`, `range` sets `offset` and `limit`, `rpc`
 * posts its arguments. A request is captured when it is awaited, as postgrest-js sends it.
 */
class FakeBuilder implements PromiseLike<Result> {
  signal?: AbortSignal;
  constructor(
    readonly url: URL,
    readonly method: SentRequest["method"],
    readonly sent: SentRequest[],
    readonly answer: Answer,
    readonly prefer?: string,
    readonly body?: unknown,
  ) {}
  or(filters: string): this {
    this.url.searchParams.append("or", `(${filters})`);
    return this;
  }
  order(column: string, { ascending = true, nullsFirst }: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    const existing = this.url.searchParams.get("order");
    this.url.searchParams.set("order", `${existing ? `${existing},` : ""}${column}.${ascending ? "asc" : "desc"}${nullsFirst === undefined ? "" : nullsFirst ? ".nullsfirst" : ".nullslast"}`);
    return this;
  }
  range(from: number, to: number): this {
    this.url.searchParams.set("offset", `${from}`);
    this.url.searchParams.set("limit", `${to - from + 1}`);
    return this;
  }
  abortSignal(signal: AbortSignal): this {
    this.signal = signal;
    return this;
  }
  // eslint-disable-next-line unicorn/no-thenable -- a postgrest-js builder is a thenable
  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    const request: SentRequest = { method: this.method, url: new URL(this.url.href), prefer: this.prefer, body: this.body, signal: this.signal };
    this.sent.push(request);
    const result: Result = { data: this.method === "HEAD" ? null : [], error: null, count: null, ...this.answer(request) };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(answer: Answer = () => undefined): { client: SupabaseClientLike; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const client = {
    from: (relation: string) => ({
      select: (columns = "*", { head = false, count }: { head?: boolean; count?: string } = {}) => {
        let quoted = false;
        const cleaned = [...columns]
          .map((char) => {
            if (/\s/.test(char) && !quoted) return "";
            if (char === '"') quoted = !quoted;
            return char;
          })
          .join("");
        const url = new URL(`${REST_URL}/${relation}`);
        url.searchParams.set("select", cleaned);
        return new FakeBuilder(url, head ? "HEAD" : "GET", sent, answer, count ? `count=${count}` : undefined);
      },
    }),
    rpc: (fn: string, args: object = {}) => new FakeBuilder(new URL(`${REST_URL}/rpc/${fn}`), "POST", sent, answer, undefined, JSON.parse(JSON.stringify(args))),
  };
  return { client, sent };
}
