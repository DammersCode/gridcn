// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommentsServer, type CommentsServer, type CommentsServerMode } from "../../../examples/data-grid-comments-demo-server";
import { createCommentEngine, type CommentEngine } from "../comment-engine";
import type { CellComment, CommentChange, CommentSaveAck } from "../types";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Job = {
  client: number;
  change: CommentChange;
  resolve: (ack: CommentSaveAck | undefined) => void;
  reject: (error: Error) => void;
  state: "queued" | "applied";
  ack?: CommentSaveAck | undefined;
  failure: "none" | "before" | "after";
};

type Client = {
  engine: CommentEngine;
  inbox: CommentChange[];
  maxVersion: Map<string, number>;
  latestNext: readonly CellComment[];
  controlled: boolean;
  nextSeen: boolean;
};

const ROWS = ["r1", "r2", "r3"];
const COLS = ["a", "b"];

type Scenario = { mode: CommentsServerMode; stamp: boolean; controlled: boolean; clients: number; throws: boolean };

const engines: CommentEngine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  vi.useRealTimers();
});

function key(c: CellComment): string {
  return `${c.version}|${c.text}|${c.resolved}`;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function runScenario(seed: number, scenario: Scenario): Promise<string | null> {
  vi.useFakeTimers();
  const random = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const server: CommentsServer = createCommentsServer({ mode: scenario.mode, stamp: scenario.stamp, now: () => 1_000_000 + Math.floor(random() * 1000) });
  const jobs: Job[] = [];
  const clients: Client[] = [];
  let tick = 0;
  let idCounter = 0;

  for (let i = 0; i < scenario.clients; i += 1) {
    const client: Client = { engine: undefined as unknown as CommentEngine, inbox: [], maxVersion: new Map(), latestNext: [], controlled: scenario.controlled, nextSeen: false };
    const index = i;
    const options = {
      currentUser: { id: `u${i}`, name: `User ${i}` },
      canEdit: () => true,
      canDelete: () => true,
      createId: () => `c${(idCounter += 1)}`,
      comments: scenario.controlled ? ([] as CellComment[]) : undefined,
      fetchComments: async ({ rowIds }: { rowIds: readonly string[] }) => server.list(rowIds),
      onCommentSave: (ctx: { change: CommentChange }) =>
        new Promise<CommentSaveAck | undefined>((resolve, reject) => {
          const failure = scenario.throws && random() < 0.15 ? (random() < 0.5 ? "before" : "after") : "none";
          jobs.push({ client: index, change: ctx.change, resolve, reject, state: "queued", failure });
        }),
      onLocalChange: (change: CommentChange) => {
        if (random() < 0.5) for (const peer of clients) if (peer !== client) peer.inbox.push(change);
      },
      onCommentsChange: (next: readonly CellComment[]) => {
        client.latestNext = next;
        client.nextSeen = true;
        for (const record of next) if (client.engine.store.core.confirmed.get(record.id)?.version !== record.version) throw new Error(`next holds a record that is not confirmed: ${record.id}`);
      },
    };
    client.engine = createCommentEngine({ getOptions: () => options, controlled: scenario.controlled, initialComments: options.comments, now: () => Date.now() });
    engines.push(client.engine);
    clients.push(client);
  }

  const liveOf = (c: Client): CellComment[] => Array.from(c.engine.store.core.confirmed.values());
  let failure: string | null = null;
  const trace: string[] = [];
  const fail = (message: string): void => {
    failure ??= [`seed ${seed} ${JSON.stringify(scenario)} tick ${tick}: ${message}`, ...trace.slice(-60)].join("\n");
  };

  const checkMonotone = (): void => {
    for (const [ci, client] of clients.entries()) {
      for (const record of client.engine.store.core.confirmed.values()) {
        const seen = client.maxVersion.get(record.id) ?? 0;
        if (record.version < seen && !scenario.controlled) fail(`client ${ci} version of ${record.id} dropped ${seen} -> ${record.version}`);
        client.maxVersion.set(record.id, Math.max(seen, record.version));
      }
      if (client.engine.store.core.confirmed.size > 50_000) fail("bound");
    }
  };

  const applyJob = (job: Job): void => {
    if (job.failure === "before") {
      job.state = "applied";
      return;
    }
    const result = server.apply(job.change);
    trace.push(`t${tick} server applied ${JSON.stringify(job.change.kind === 'upsert' ? {id: job.change.comment.id, v: job.change.comment.version, base: job.change.baseVersion, from: job.client, text: job.change.comment.text} : job.change)} -> ${JSON.stringify(result.ack)?.slice(0,80)}`);
    job.ack = result.ack;
    job.state = "applied";
    if (result.broadcast) for (const [ci, peer] of clients.entries()) if (ci !== job.client) peer.inbox.push(result.broadcast);
  };

  const deliverAck = (job: Job): void => {
    jobs.splice(jobs.indexOf(job), 1);
    if (job.failure !== "none") job.reject(new Error("network"));
    else job.resolve(job.ack);
  };

  const localAction = async (client: Client): Promise<void> => {
    const live = liveOf(client).filter((c) => !client.engine.store.core.pending.has(c.id));
    const roll = random();
    if (live.length === 0 || roll < 0.35) {
      await client.engine.create({ rowId: pick(ROWS), columnId: pick(COLS), text: `t${tick}` });
    } else {
      const target = pick(live);
      if (roll < 0.6) await client.engine.edit(target.id, `e${tick}`);
      else if (roll < 0.8) await client.engine.setResolved(target.id, !target.resolved);
      else if (roll < 0.9) await client.engine.remove(target.id);
      else {
        const conflict = Array.from(client.engine.store.core.conflicts.values())[0];
        if (conflict?.thrown) await client.engine.retry(conflict.id, conflict.text);
        else if (conflict) client.engine.discard(conflict.id);
      }
    }
  };

  const steps = 40 + Math.floor(random() * 60);
  for (; tick < steps; tick += 1) {
    const roll = random();
    if (roll < 0.35) await localAction(pick(clients));
    else if (roll < 0.55) {
      const queued = jobs.filter((j) => j.state === "queued");
      if (queued.length > 0) applyJob(pick(queued));
    } else if (roll < 0.75) {
      const applied = jobs.filter((j) => j.state === "applied");
      if (applied.length > 0) deliverAck(pick(applied));
    } else if (roll < 0.95) {
      const client = pick(clients);
      const message = client.inbox.shift();
      if (message) {
        trace.push(`t${tick} client ${clients.indexOf(client)} remote ${JSON.stringify(message.kind === 'upsert' ? {id: message.comment.id, v: message.comment.version, text: message.comment.text} : message)}`);
        client.engine.applyRemote([message]);
        if (random() < 0.2) client.inbox.push(message);
      }
    } else if (scenario.controlled) {
      const client = pick(clients);
      if (client.nextSeen) client.engine.syncProp(client.latestNext);
    }
    await flush();
    checkMonotone();
  }

  // drain: deliver everything, retry thrown writes, until quiet
  for (let round = 0; round < 40; round += 1) {
    let busy = false;
    for (const job of Array.from(jobs)) {
      if (job.state === "queued") applyJob(job);
      deliverAck(job);
      busy = true;
    }
    await flush();
    for (const client of clients) {
      while (client.inbox.length > 0) {
        const message = client.inbox.shift() as CommentChange;
        client.engine.applyRemote([message]);
        busy = true;
      }
      for (const conflict of Array.from(client.engine.store.core.conflicts.values())) {
        if (conflict.thrown) {
          await client.engine.retry(conflict.id, conflict.text);
          busy = true;
        } else client.engine.discard(conflict.id);
      }
    }
    await flush();
    checkMonotone();
    if (!busy && jobs.length === 0) break;
  }
  for (const client of clients) if (scenario.controlled && client.nextSeen) client.engine.syncProp(client.latestNext);

  const snapshot = (records: Iterable<CellComment>): string[] => Array.from(records).map((c) => `${c.id}:${key(c)}`).sort();
  const expected = snapshot(server.records.values());
  for (const [ci, client] of clients.entries()) {
    if (client.engine.store.core.pending.size > 0) fail(`client ${ci} still has a pending write`);
  }
  const beforeFetch = clients.map((c) => snapshot(liveOf(c)));
  const convergedBeforeFetch = beforeFetch.every((s) => JSON.stringify(s) === JSON.stringify(expected));
  if (scenario.mode === "cas" && !convergedBeforeFetch) {
    clients.forEach((_, ci) => {
      if (JSON.stringify(beforeFetch[ci]) !== JSON.stringify(expected)) fail(`CAS client ${ci} diverged before fetch\n  client: ${beforeFetch[ci]?.join(" ")}\n  server: ${expected.join(" ")}`);
    });
  }

  for (const client of clients) client.engine.noteRowsRendered(ROWS);
  await vi.advanceTimersByTimeAsync(400);
  await flush();
  clients.forEach((client, ci) => {
    const after = snapshot(liveOf(client));
    if (JSON.stringify(after) !== JSON.stringify(expected)) fail(`client ${ci} diverged after fetch\n  client: ${after.join(" ")}\n  server: ${expected.join(" ")}`);
  });
  for (const e of engines.splice(0)) e.dispose();
  vi.useRealTimers();
  return failure;
}

const scenarios: Scenario[] = [
  { mode: "cas", stamp: false, controlled: false, clients: 2, throws: false },
  { mode: "cas", stamp: true, controlled: false, clients: 3, throws: false },
  { mode: "cas", stamp: false, controlled: false, clients: 3, throws: true },
  { mode: "cas", stamp: true, controlled: true, clients: 2, throws: true },
  { mode: "lww", stamp: false, controlled: false, clients: 2, throws: false },
  { mode: "lww", stamp: true, controlled: false, clients: 3, throws: true },
];

describe("model test: clients converge on an authoritative server", () => {
  for (const scenario of scenarios) {
    it(`${scenario.mode}${scenario.stamp ? " + stamping" : ""}${scenario.controlled ? " + controlled" : ""}${scenario.throws ? " + throws" : ""}, ${scenario.clients} clients`, async () => {
      for (let seed = 1; seed <= 60; seed += 1) {
        const failure = await runScenario(seed * 7919 + scenarios.indexOf(scenario), scenario);
        expect(failure).toBeNull();
      }
    }, 120_000);
  }
});
