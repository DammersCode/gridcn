import { QueryError, statusForCode } from "./errors";

export type HandleGridRequestOptions = {
  /** Most body bytes read before `JSON.parse`. Default: the `maxBodyBytes` of `run` (8 MiB for `selection`), else 524288. */
  maxBodyBytes?: number;
};

type CallArgs<TContext> = [TContext] extends [never] ? [opts?: { signal?: AbortSignal }] : [opts: { signal?: AbortSignal; context: TContext }];

const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function readBody(req: Request, maxBytes: number): Promise<string | null> {
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Reads the JSON body with a byte cap, runs a query method, and answers JSON. A {@link QueryError} becomes a 4xx with its
 * code and no value; every other error becomes a 500 with no message. `req.signal` reaches the query.
 *
 * @example
 * export const POST = (req: Request) => handleGridRequest(req, usersQuery.fetchRows);
 */
export async function handleGridRequest<TContext = never, TAnswer = unknown>(
  req: Request,
  run: (input: unknown, ...opts: CallArgs<TContext>) => Promise<TAnswer>,
  ...opts: [TContext] extends [never] ? [opts?: HandleGridRequestOptions] : [opts: HandleGridRequestOptions & { context: TContext }]
): Promise<Response> {
  const options = (opts[0] ?? {}) as HandleGridRequestOptions & { context?: TContext };
  try {
    const ownCap: unknown = (run as { maxBodyBytes?: unknown }).maxBodyBytes;
    const text = await readBody(req, options.maxBodyBytes ?? (typeof ownCap === "number" ? ownCap : DEFAULT_MAX_BODY_BYTES));
    if (text === null) return json(413, { error: "payload-too-large" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "invalid-request" });
    }
    const callOptions = { signal: req.signal, ...(options.context === undefined ? {} : { context: options.context }) };
    const answer = await (run as (input: unknown, opts: unknown) => Promise<TAnswer>)(body, callOptions);
    return json(200, answer);
  } catch (error) {
    if (error instanceof QueryError) return json(statusForCode(error.code), { error: error.code, path: error.path });
    return json(500, { error: "server-error" });
  }
}
