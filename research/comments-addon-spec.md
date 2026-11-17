# Cell comments add-on (`data-grid-comments`) — spec

Status: implemented on the 2.0 line (the id swap, textarea, and docs ruleset the first draft waited for are all merged). Issue: #95. Target: release 2.0.0. Input: `research/comments-addon-research.md`. Section 24 lists where the implementation settled differently from the draft.

## 1. Goals and non-goals

Goals:

- Attach comments to cells, identified by row id and column id. Show a marker. Open a comments popover. Create, edit, delete, resolve, reopen by pointer and keyboard.
- Several people see and change the same comments. The app owns transport and save. The add-on owns local state, optimistic writes, versions, and echo handling.
- Work in client mode, pagination, lazy/server rows, `sortMode`/`filterMode` `"server"`, controlled mode, and an app's own API.
- No measurable scroll cost at 100k rows.

Non-goals (v1): reply threads, mentions, notifications, rich text, attachments, comments on rows or columns, bundled transport or save, undo/redo of comments, comment export to spreadsheet files, search over comment text, a row filter by comment state.

## 2. Decisions at a glance

| # | Decision | Why |
|---|---|---|
| D1 | Address is `{ rowId, columnId }` only. The add-on never decides a comment is orphaned by itself. | In server/lazy modes a hole or evicted row looks like a deleted row. |
| D2 | Flat list per cell, `resolved` per comment. A cell is *unresolved* while any of its comments is unresolved. | A later optional `parentId` adds threads without a breaking change. |
| D3 | The marker is an Overlay element per commented cell in the rendered rows. The cell DOM is not touched. | The plugin contract has no per-cell member (`research/plugin-system-spec.md`, decision 1). |
| D4 | Per-comment integer `version`. A local write carries `baseVersion` and shows `baseVersion + 1`. The transport accepts only if its version equals `baseVersion`. | Compare-and-swap, like `onSave` rejection with `current`. No CRDT for short text. |
| D5 | Every write has a `writeId`, stored on the record. A record that carries the pending `writeId` is the echo of that write. | Echo detection without comparing content. |
| D6 | Comments live outside the grid history. | Shared state; an undo would be a new write with its own conflict. |
| D7 | Open key `Shift+F2` plus a context-menu resolver. | `Ctrl+Alt+M` is AltGr on Windows; `Mod+Shift+M` is browser-reserved. |
| D8 | Grid `readOnly` blocks comment writes unless `allowWhenReadOnly`. | Review lesson: every write path checks `readOnly`. |
| D9 | "Filter shows unresolved comments only" is a marker filter (`hideResolved`), not a row filter. | A row filter needs a core filter predicate; the app can build one from `getComments()` (Q9). |
| D10 | One save callback `onCommentSave` replaces the four `onCommentCreate/Update/Delete/Resolve` of the issue sketch; `ctx.action` names the kind. | Core has one `onSave`. The owner may ask for the four names as sugar (Q8). |
| D11 | The marker is `aria-hidden`, like every core and presence overlay (plugin overlays sit inside `role="grid"`). The keyboard and screen-reader path is the active cell, `Shift+F2`, a status announcement, and the context menu. | A plugin cannot add `aria-describedby` to a cell. Q3 proposes the core seam; it is the proper fix for WCAG 1.3.1. |
| D12 | `onLocalChange(change)` fires once per local write, after the write is confirmed. Compare-and-swap is the conflict model, with last writer wins as the tie fallback. | Peers never see an optimistic version that a rejection later withdraws. |
| D13 | The client `id` is the permanent comment key; the server keeps it. | Server-assigned keys need alias maps and more rules (Q10). |

Deviations from the issue sketch: D9, D10, D11, D12; `canEdit(comment)` and `applyRemote(change)` take a ctx object and a batch (Q8 covers the shape).

## 3. Data model

```ts
export type CommentAuthor = {
  id: string;            // 1..128 chars, no control characters
  name?: string;         // max 80 chars; control and bidi-override characters stripped
  color?: string;        // max 64 chars; CSS color checked with CSS.supports at render, fallback token
};

export type CellComment = {
  id: string;            // client-generated (createId); the create idempotency key
  rowId: string;
  columnId: string;
  text: string;          // 1..maxTextLength after trim
  author: CommentAuthor;
  createdAt: number;     // epoch ms, finite
  updatedAt: number;     // epoch ms, finite; the server should stamp it
  version: number;       // integer 1..1_000_000_000; +1 per accepted write (a stamping server may return a higher one)
  writeId?: string;      // id of the write that produced this version (add-on generated)
  resolved: boolean;
  resolvedBy?: CommentAuthor;
  resolvedAt?: number;
};

export type CommentChange =
  | { kind: "upsert"; comment: CellComment; baseVersion?: number }
  | { kind: "delete"; id: string; rowId: string; columnId: string; version: number; writeId?: string; baseVersion?: number };

export type CommentSource = "ack" | "remote" | "fetch" | "id-swap" | "remove";
```

Resolve and reopen are `upsert` with `resolved` changed. A delete is a tombstone: new `version`, no text, no author. The add-on generates `writeId` itself (per-hook random prefix plus crypto-random suffix), never from `createId`, so a peer cannot predict it.

Bounds (options with safe defaults and hard ceilings; text length is checked on the raw input first (raw cap 4 × `maxTextLength`), then `normalizeText` runs, then every bound is checked on its output; invalid option values (NaN, zero, negative, fractional) fall back to the default and clamp to the ceiling; `currentUser` and `createId()` output pass `validate.ts`, and an invalid one refuses the write with reason `"invalid"`):

| Option | Default | Ceiling | On breach |
|---|---|---|---|
| `maxTextLength` | 2,000 | 20,000 | write refused (`"limit"`); remote record dropped |
| `maxCommentsPerCell` | 50 | 500 | write refused; remote record dropped |
| `maxComments` (in store) | 50,000 | 500,000 | write refused; remote record dropped |
| `maxCachedRows` (uncontrolled fetch cache) | 2,000 | 20,000 | least recently rendered rows evicted (section 8) |

Constants: tombstone TTL 10 min, at most 10,000 tombstones, `applyRemote` batch 10,000 changes, fetch answer 10,000 records, row-id alias map 10,000 entries, `MAX_MARKERS = 2048`, emitted-record memory up to 10,000 entries for 30 s, 10-frame `openComments` wait, 100 listed verdict entries, 60-character dialog label, drafts 50, observed-insert row set 10,000, fetch live log 1,000, fetch debounce 150 ms, 200 ids per batch, 2 requests in flight, 2 s retry gap, 30 s request timeout, announcer debounce 250 ms.

Order inside a cell: `(createdAt, id)` ascending. A confirmed record's `createdAt` replaces the client value.

## 4. Public API

The hook is called outside the provider like `useDataGridPresence`; its `plugin` goes into `plugins={[...]}` (scroll mode: `[...server.gridProps.plugins, comments.plugin]`).

```ts
export function useDataGridComments(options: UseDataGridCommentsOptions = {}): UseDataGridCommentsResult;

export type UseDataGridCommentsOptions = {
  currentUser?: CommentAuthor;               // without it the popover is read-only
  comments?: readonly CellComment[];         // controlled
  defaultComments?: readonly CellComment[];  // one-shot seed
  onCommentsChange?: (next: readonly CellComment[], ctx: CommentsChangeCtx) => void;
  onCommentSave?: (ctx: CommentSaveCtx) => CommentSaveResult;
  onCommentRejected?: (ctx: CommentRejectedCtx) => void;
  onLocalChange?: (change: CommentChange) => void;
  canCreate?: (ctx: CommentCreateGateCtx) => boolean | Promise<boolean>;
  canEdit?: (ctx: CommentGateCtx) => boolean | Promise<boolean>;     // default: author is current user
  canDelete?: (ctx: CommentGateCtx) => boolean | Promise<boolean>;   // default: author is current user
  canResolve?: (ctx: CommentGateCtx) => boolean | Promise<boolean>;  // default: true
  fetchComments?: (ctx: CommentFetchCtx) => Promise<readonly CellComment[]>;
  onFetchError?: (ctx: CommentFetchErrorCtx) => void;   // failed request, or records dropped for a bound
  onOrphanedComments?: (ctx: OrphanedCommentsCtx) => void;
  createId?: () => string;                   // default: crypto.randomUUID with a fallback outside secure contexts
  normalizeText?: (text: string) => string;
  maxTextLength?: number; maxCommentsPerCell?: number; maxComments?: number; maxCachedRows?: number;
  allowWhenReadOnly?: boolean;               // default false
  hideResolved?: boolean;                    // default false: marker filter
  labels?: Partial<DataGridCommentsLabels>;
  className?: string;                        // popover root, merged with cn
};
```

Ctx shapes (several values of equal rank take one object; gate and fetch `signal`s abort on unmount or when the request is superseded; a save is never aborted):

```ts
export type CommentsChangeCtx = { changes: readonly CommentChange[]; source: CommentSource };
export type CommentSaveCtx = {
  action: "create" | "update" | "delete" | "resolve" | "reopen";
  change: CommentChange;       // carries baseVersion, writeId, the new record
  prev?: CellComment;          // last confirmed record before the write
};
export type CommentGateCtx = { comment: CellComment; user: CommentAuthor; signal: AbortSignal };
export type CommentCreateGateCtx = { rowId: string; columnId: string; user: CommentAuthor; signal: AbortSignal };
export type CommentFetchCtx = { rowIds: readonly string[]; signal: AbortSignal };
export type CommentFetchErrorCtx = { reason: "error" | "limit"; rowIds: readonly string[]; error?: unknown };
export type CommentRejectReason = "stale" | "forbidden" | "invalid" | "limit" | "read-only" | "row-busy" | "error";
export type CommentSaveAck =
  | { comment?: CellComment | null }                                   // authoritative record; null = deleted
  | { rejected: { reason: "stale" | "forbidden" | "invalid" | "limit"; message?: string; current?: CellComment | null } };
export type CommentSaveResult = void | CommentSaveAck | Promise<void | CommentSaveAck>;
export type CommentRejectedCtx = { action: CommentSaveCtx["action"]; change?: CommentChange;   // absent when refused before a record exists (invalid `createId`/`currentUser`)
  reason: CommentRejectReason; message?: string; current?: CellComment | null; error?: unknown };
export type OrphanedCommentsCtx = { comments: readonly CellComment[]; rowIds: readonly string[]; source: DataChange<unknown>["source"] };
```

What fires when (the only callback matrix):

| Event | `onCommentsChange` source | `onLocalChange` | `onCommentSave` | `onCommentRejected` |
|---|---|---|---|---|
| Local write applied (optimistic, internal overlay) | none | no | runs | no |
| Local write without `onCommentSave` (confirms at once) | `"ack"` (one call) | once | no | no |
| Save acknowledgement accepted | `"ack"` (record replaced by the authoritative one) | once, with the authoritative change | no | no |
| Echo of the pending write through `applyRemote` or a fetch answer, before the acknowledgement | `"remote"` / `"fetch"` | once (a later acknowledgement still applies a newer `{ comment }` by rule 4) | no | no |
| Rejection, throw, gate, bound, `readOnly`, or row-busy refusal | none, except `stale` with `current`: `"ack"` (the replacement record) | no | no | yes, with the reason |
| Controlled prop change, seed | none (the prop is the app's own state) | only for a prop echo of a pending write: once | no | no |
| `applyRemote` | `"remote"` | no | no | no |
| `fetchComments` answer | `"fetch"` | no | no | no |
| Fetch cache eviction (uncontrolled) | none | no | no | no |
| Id swap | `"id-swap"` | no | no | no |
| `removeComments` | `"remove"` | no | no | no |

Notes:

- No `onCommentRejected` fires after an echo has confirmed the write or for a write superseded by a delete; a stale answer that carries the write's own `writeId` is a confirm (`"ack"`, `onLocalChange` once, no `onCommentRejected`); a superseded `void` acknowledgement (newer version or tombstone) emits nothing; `{ comment: null }` on an edit is a delete, and `onLocalChange` relays that delete.
- `onCommentSave` returning `void` accepts the write as sent. `{ comment }` replaces the optimistic record. `{ rejected }` or a throw rolls back (section 6).
- `onLocalChange` is the broadcast seam: the app forwards the confirmed change to its channel. It cannot refuse. Without `onCommentSave` it fires immediately, so a fire-and-forget transport broadcasts from it too.
- `onCommentsChange` is the state channel: one call per store write with the batch, `next` built only when the listener exists and holding confirmed records only. An app that saves state from it never stores an unconfirmed record. With `fetchComments`, `next` is a partial cache: save from `ctx.changes`, never from `next`.
- Callbacks run after the outermost store write, each isolated in try/catch.

Result:

```ts
export type UseDataGridCommentsResult = {
  plugin: DataGridPlugin;
  applyRemote(changes: readonly CommentChange[]): ApplyRemoteVerdict;
  getComments(): readonly CellComment[];                 // bounded snapshot, not reactive; may be partial under the fetch cache
  removeComments(target: { rowIds: readonly string[] }): number;   // emits onCommentsChange (source "remove"); discards pending writes, drafts, conflicts, and an open popover of the removed comments and tombstones them at `max(known version, baseVersion + 1)`
  refetchComments(target?: { rowIds?: readonly string[] }): void;
  openComments(ref: { rowId: string; columnId: string }): boolean;  // false for a hole, a filtered-out row, or a hidden column
  closeComments(): void;
  getCommentMenuItems: CommentMenuItemsResolver;
};
export type ApplyRemoteVerdict = {
  applied: number;
  skippedCount: number;
  skipped: readonly { index: number; reason: "stale" | "duplicate" | "invalid" | "limit" | "tombstoned" | "unknown" }[];   // first 100
  truncated: number;                                     // changes beyond the batch limit, ignored
};
```

`CommentMenuItemsResolver` is a structural type compatible with the context menu's `CellMenuItemsResolver`; the add-on does not import the context-menu add-on. The barrel exports `useDataGridComments`, the option/result/ctx/ack/verdict types above, `CellComment`, `CommentAuthor`, `CommentChange`, `CommentSource`, `DataGridCommentsLabels`. Store, reducer, validators stay internal. The option list is long because the issue asks for these seams; each field has a default and a docs row on the options page.

## 5. Controlled and uncontrolled

- Uncontrolled: `defaultComments` seeds once; the add-on store is the truth.
- Records from `comments` and `defaultComments` pass through `validate.ts` per changed record and count against the bounds, like remote records (dropped records are reported once in development).
- Controlled: `comments` is the confirmed truth. `next` in `onCommentsChange` holds confirmed records only: the add-on's confirmed set, which is the last prop plus the changes since. Optimistic records stay in an internal overlay. The UI shows confirmed records overlaid with pending optimistic ones, and keeps showing a confirmed record the prop has not returned yet (a memory of emitted records keyed by `(id, version, writeId)`, sized to the largest single emit and capped at 10,000 entries, each dropped when the prop returns it or after 30 s; a prop record is a duplicate only if it matches the confirmed record). Records the add-on did not change keep the app's original objects, including extra fields; changed records hold only the typed fields.
- A prop change is the reducer event `propChange`. A record counts as changed only when it differs from the same record in the previous prop in any typed field (`id`, `rowId`, `columnId`, `text`, `author`, `version`, `writeId`, `createdAt`, `updatedAt`, `resolved`, `resolvedBy`, `resolvedAt`); the previous prop, not the add-on's index, is the baseline, so a lagging async prop rebuilt on every render changes nothing. A changed record replaces the confirmed record on any typed-field difference (echo matching, rule 4(a), runs first; a changed address is accepted as the app moving the comment, after the row-id alias map); the prop is the app's own state, so it may lower a version (the "never lowers" rule holds for every other source), and a comment that was in the previous prop and is absent from the new one is forgotten without a tombstone, and its row is marked unfetched. Changed prop records pass tombstones (the app itself changed its state); unchanged ones never resurrect a comment. A pending write on a changed or removed comment is judged at its acknowledgement (rule 6). A prop record equal to one the add-on emitted is a duplicate and a no-op. A prop that equals the last emitted array skips re-indexing; otherwise unchanged records are skipped by the typed-field comparison above (so `rows.map(toComment)` on every render costs a comparison, not a validation), and only changed records are validated and processed. A removal of a comment the add-on already holds as deleted, or already emitted a delete for (fetch absence, `removeComments`), is a no-op.
- Pending state (`baseVersion`, `writeId`, drafts, conflicts) stays in the add-on in both modes. A pending write is confirmed only by its save acknowledgement or by its echo (rule 4a) through `applyRemote`, fetch, or the prop; a prop record that differs from the pending write is a remote change.
- `applyRemote`, `fetchComments` (source `"fetch"`), and `removeComments` work in both modes. In controlled mode they emit `onCommentsChange` and the UI updates at once from the emitted-record memory.
- The fetch cache LRU runs in uncontrolled mode only. In controlled mode the app owns eviction; the app array is bounded by `maxComments`, and fetched records beyond it are dropped and reported through `onFetchError`. Parity tests cover this case.
- The index is `Map<rowId, Map<columnId, CellComment[]>>`, built once per changed content.

## 6. Conflict and echo model

The reducer is pure (`comment-reducer.ts`). Time, `writeId`, and `createId` values come in as event payloads. Per comment id the state is a product of parts: `confirmed`, `pending`, `draft`, `conflict`, `tombstone`. Events: local create/update/delete/resolve/reopen, gate result, acknowledgement (each result), throw, remote upsert and delete, fetch start, fetch answer, fetch failure or timeout, `propChange`, `removeComments`, eviction, id swap, draft open and discard, `readOnly` change, row status change, tombstone expiry, unmount. The reducer test table enumerates every (part, event) pair that can occur. A same-version tie (a transport without compare-and-swap) resolves by rule 4(b) on every client, and a fetch heals any remaining split (the last-writer-wins model test ends with one fetch per client) (docs: `void` without compare-and-swap converges only after a fetch); the model test also runs a last-writer-wins server variant and a stamping server (which returns `{ comment }`).

Definitions: the *confirmed record* of an id is the last record accepted from the server side (acknowledgement, remote, fetch, prop, or seed). *Known version* is its version; the optimistic `b + 1` is display only. A `void` acknowledgement means the server stored the write exactly as sent: the record becomes confirmed at `b + 1` and `onLocalChange` relays it as built. A server that stamps any field (`createdAt`, `updatedAt`, `author`, or a version other than `b + 1`) must return `{ comment }`. The client `id` is the permanent key: the server must keep it (Q10).

1. One write in flight per comment id. While it is pending (until its echo or its acknowledgement arrives, whichever is first; the later one changes nothing except a newer `{ comment }`) the popover shows that comment as "Saving" and marks its actions `aria-disabled`; there is no queue. A write is never aborted: acknowledgements settle after `readOnly` turns on or after unmount, and `onCommentRejected` still fires. A hung `onCommentSave` keeps that comment "Saving"; the app owns timeouts (docs).
2. A draft (composer, edit, delete confirm) captures the base `(version, writeId)` of the confirmed record when it opens (a create uses version 0), and counts as stale when either differs later. The save acknowledgement or echo of this client's own write rebases an open draft of that comment only when the draft's base equals the write's base and the confirmed version becomes the version the write was confirmed at (`b + 1` for a `void` acknowledgement); any other change to the confirmed record makes the draft stale: the conflict UI shows on submit instead of overwriting.
3. Incoming records and acknowledgements never lower the confirmed version (prop change excepted, section 5).
4. Matching an incoming record (remote, fetch) of a known or unknown id; a prop record runs only (a), then rule 5 after the alias map, then replaces the confirmed record (section 5): (a) a record that carries the pending `writeId` of that comment, with matching addresses and `version >= baseVersion + 1`, is the echo of the write: it confirms it, as an acknowledgement does; (b) otherwise compare with the confirmed record: `version <` known: skip (`"stale"`); same version and same `writeId`: skip (`"duplicate"`); same version, different `writeId`: a delete beats an upsert; a server-sourced record (an acknowledgement with `{ comment }`, a `void` acknowledgement of our own write when `onCommentSave` exists, or a fetch record) beats a relayed one (remote) and marks that version server-confirmed, after which relayed records at that version are skipped; a write that confirms at once (no `onCommentSave`) counts as relayed; a fetch record whose id was not touched since its request started beats any same-version tie, including against a tombstone (this never happens under compare-and-swap); otherwise higher `updatedAt` wins, then the larger `writeId` string (an absent `writeId` counts as the empty string); a tie loser counts as `"stale"`; `version >` known: apply as confirmed. A pending write stays displayed over an applied record and is judged at its acknowledgement (rule 6).
5. Addresses (`rowId`, `columnId`) of a known id are immutable. `author.id` is immutable once the comment has a confirmed record. A record that changes them is dropped (`"invalid"`), except an id-swap remap. `createdAt`, `updatedAt`, `writeId`, and `version` always come from the newer record.
6. Acknowledgement of a pending write: `void`, confirmed version `< baseVersion + 1`: confirmed at `b + 1` as sent; confirmed version `> b + 1`, or the newer record is a tombstone: the write is superseded, the confirmed record does not change, nothing is emitted and no `onLocalChange` fires; confirmed version `== b + 1` from a relayed record that is not our echo: the write is confirmed, it replaces that record by the tie rule above, `"ack"` is emitted, and `onLocalChange` fires once (unless the echo already fired it). `{ comment }`: apply by rule 4(b). `{ comment: null }` for a non-delete: a delete at `b + 1`. A record that fails validation, the bounds, or rule 5 counts as a rejection `"invalid"`. `onLocalChange` fires exactly once per confirmed write (not again when the echo or the acknowledgement arrives second). Rejection `stale`: apply `current` if given by rule 4(b) (it never lowers the confirmed version), else to the confirmed record and refetch that row when `fetchComments` is set. Any other explicit rejection: roll back to the confirmed record; a later user retry after an explicit rejection takes a fresh `writeId`. A throw or rejection that arrives after the echo already confirmed the write is ignored (no rollback, no `onCommentRejected`). A throw otherwise: roll back, but the outcome is unknown. The thrown `writeId` stays with the conflict until the conflict is discarded or the comment gets a newer confirmed record (bounded with the 50 drafts), and rule 4(a) matches an echo of it as if it were pending (it confirms, fires `onLocalChange`, and clears the conflict). The popover shows the draft with a Retry control: an unchanged draft resubmits the same write (same `writeId`, same `baseVersion`); an edited draft is a new write with a fresh `writeId`. A stale rejection whose `current` carries the write's own `writeId`, for any action and any attempt, is applied through rule 4 including 4(a), so it confirms. On every rollback the user's text becomes `conflict.draft` (a delete or resolve conflict has no text: the popover shows "Changed by someone else" and the user repeats the action) and `onCommentRejected` fires. A rollback that replaces the confirmed record (`stale` with `current`, including `current: null`) emits that replacement through `onCommentsChange` (source `"ack"`); other rollbacks emit nothing because the confirmed state did not change. A `stale` rejection without `current` and without `fetchComments` leaves the conflict UI with Discard only (a development warning asks the transport to send `current`). "Save my version" is an explicit new write whose `baseVersion` is the version of the record the conflict UI displayed.
7. Delete: a confirmed delete (local acknowledgement, remote delete with `version >` known, `current: null`, a remote or acknowledged removal) makes a tombstone `{ id, address, version, expiry }` (version `b + 1` when the source has none) and supersedes a pending local edit: the write stays in flight, the comment shows as deleted, and the edit's text is offered at once as a draft for a new comment (never auto-resubmitted). The later acknowledgement or rejection of the superseded write changes nothing and fires no `onCommentRejected` and no `onLocalChange`. A stale answer with `current: null` for our own delete is a confirm. A remote delete for an unknown id is ignored, except while a fetch for its row is in flight (rule 10). A tombstone blocks upserts with `version <= tombstone.version` until expiry; the 10,000 cap and TTL bound this guarantee. A very late old upsert after expiry can resurrect a comment until the next fetch. Transports keep per-comment order.
8. After every `await` the add-on re-reads the store and re-checks, for a user write: the comment was not removed or remapped, `readOnly` (unless `allowWhenReadOnly`), `currentUser`, the row-busy gate, the draft's base `(version, writeId)` against the confirmed record (a mismatch is a stale conflict), and the bounds. Acknowledgements settle regardless of `readOnly` and unmount (no new write starts). Late acknowledgements for an older `writeId` are ignored.
9. Gates (`canX`) run before the optimistic write. A gate, `normalizeText`, or `createId` that throws, or a gate that returns a rejected promise, is a refusal with reason `"error"`. `normalizeText` applies to local writes only.
10. Fetch races: every store event stamps the touched comment id with a sequence number, and each fetch request records the sequence at its start. The answer applies per record by rule 4 (echo matching included) and removes (an emitted delete change at the known version, source `"fetch"`, no tombstone) only comments of the requested rows that are absent from it, were not touched since the request started, are not pending, and have no draft or conflict, and are not own writes confirmed in the last 30 s (a fire-and-forget transport may not have stored them yet). Remote deletes for unknown ids in a row with a fetch in flight make tombstones. A row whose id was remapped during the request, or whose live log (bounded 1,000) overflowed, has its answer discarded and is refetched. A request that does not settle within 30 s aborts and counts as a failure. An answer over the 10,000-record cap is a failure too (`onFetchError` reason `"limit"`): nothing is applied, its rows stay unfetched, and the scheduler retries with half the batch; a single row over the cap is marked failed until `refetchComments` (the composer shows the fetch error state). Absence is judged on the raw ids of the answer, before validation.
11. Row-busy gate: the observer records row ids from `DataOp` inserts only when the row's `saveStatus` is `"saving"` at that moment (bounded 10,000); rows that never enter `"saving"` (no `onSave`, a synchronous `onSave`) are never busy. A comment write on such a row is refused with `onCommentRejected` reason `"row-busy"` until the id swap, until its `saveStatus` is no longer `"saving"`, or until the row is deleted (an undone delete reaches `onSave` as a `"history"` change and is recorded like any insert; rows restored by a rollback are not); the composer shows a disabled hint. Rows with a value save in flight or a `"failed"` status stay writable, because their ids are stable. This keeps a comment from reaching the server with a temporary row id when inserts save through `onSave` promises; with fire-and-forget writes the app assigns stable ids itself (docs). The Mount watches `saveStatus` and re-notifies the fetch scheduler when a busy row settles; busy rows are not fetched.
12. Id swap (`source: "id-swap"`): the plugin's `onDataChange` observer remaps `rowId` for comments, pending writes, drafts, fetch state, and the open popover, and keeps an alias map `oldId → newId` applied to later remote, fetch, and acknowledgement records. The new id is `getRowId(op.row, index)` with the index from a row-to-index map built once per swap batch from the next array; operations whose id did not change are skipped.

Model test (seeded random, no new dependency): interleavings of local actions, acknowledgements, rejections, throws with retries, remote batches, fetch answers, and prop syncs, across 2–3 simulated clients and one authoritative in-memory server that applies compare-and-swap, in uncontrolled and controlled mode. Delivery guarantee: per-comment order is kept, duplicates are allowed, loss is healed only by fetch. Invariants: (a) clients converge to the server state once delivery quiesces; (b) confirmed `version` never decreases per id, except through a controlled prop; (c) no resurrection within TTL and under the tombstone cap; (d) an echo never creates a second comment; (e) bounds hold; (f) no write is lost without `onCommentRejected` or a tombstone; (g) the reducer is a pure function of (state, event); (h) a write is sent at most once, except an explicit Retry that reuses its `writeId`, and none is lost on unmount, `readOnly`, or row-busy; (i) `next` never contains an unconfirmed record.

## 7. Behavior on data changes

| Event | Behavior |
|---|---|
| Sort, filter, column reorder/hide | Nothing is stored differently. Markers come from a walk over the rendered rows (section 9). Comments on filtered-out rows or hidden columns stay in the store; no marker is painted. |
| Row delete (any delete change, any source incl. `"history"` and `"rollback"`) | `onOrphanedComments({ comments, rowIds, source })` fires only when at least one deleted row has comments in the store (never with an empty list; with the fetch cache the set may be partial). Comments stay in the store. Docs: remove comments on the server only after the delete is saved; an undo or a rolled-back delete brings the rows back and the comments are still there. |
| Id swap | Section 6 rule 12. |
| Lazy/server eviction or hole | No data is removed. The fetch cache drops by its own LRU; `onOrphanedComments` never fires, and when it fires for a deleted row its `comments` hold only the comments currently in the store (a partial set under the fetch cache). |
| Stream push, block load, value-only write | No effect on comments or fetch state. |
| `data` replaced, a server refresh | No `DataChange` is emitted and fetch state is kept. Docs: call `refetchComments()` after a refresh that can change comments. The open popover closes when its row is gone from the view. |
| Holes and band rows | Skipped by every reader (`rowIdAtViewRow` returns `undefined`; `useDataGridRowIds` returns placeholder ids and is not used for lookup). |

## 8. Loading comments for rendered rows

- The app owns the full set. The add-on needs only the comments of rows it paints.
- The Overlay computes the rendered non-hole row ids and, in a layout effect (not during render), writes them to a plain mutable field of the add-on store and notifies the fetch scheduler directly. No React state, no second render. The add-on does not use `onRenderedRowsChange` (the server hook occupies it).
- With `fetchComments`: debounce 150 ms; batches of at most 200 ids; at most 2 requests in flight; a batch aborts only when none of its rows is rendered. The answer follows section 6 rule 10. Records for rows not requested are dropped. Rows count as fetched only after success. A failure calls `onFetchError` and retries on the next scroll with a 2 s minimum gap. `refetchComments` invalidates rows.
- Uncontrolled fetch cache: LRU bounded by `maxCachedRows`; overflow drops comments of the least recently rendered rows, never those with a pending write, draft, conflict, or open popover. The next scroll refetches. Controlled mode: section 5.
- Without `fetchComments` the app supplies comments through `comments`, `defaultComments`, or `applyRemote`, for example from the call that loads rows (the server hook's `onLoaded` can drive `applyRemote` or `refetchComments`).
- Counts without bodies for huge sets are not in v1 (Q5).

## 9. Marker rendering and cost

- The Overlay renders `<span aria-hidden="true" data-grid-comment-marker data-unresolved>` per commented cell in the rendered rows, a small corner at the inline-end top of the cell (the fill and touch handles use the bottom-right), placed on grid lines like presence. Unresolved: filled corner. Resolved only: outline corner. The shape differs, not only the color (WCAG 1.4.1). Tokens: `bg-primary`, `border-primary`; `forced-colors:` styles and a border keep it visible; its layer sits below the selection handles and presence labels (RTL has a browser test); the active-cell ring and selection tint are checked in the radius/tint matrix for 3:1 contrast.
- Per-frame work is O(rendered rows): row ids come from a `useShallow` selector over `rowIdAtViewRow`; one `Map` lookup per row; only rows with comments walk their columns, limited to the rendered column range (`pinTrack`/column ctx; verified on merged code). `MAX_MARKERS` is a safety bound only. `useDataGridRowIdToViewRow` is called only in a child that renders while the popover is open (core shares one map per view, but it still rebuilds on every sort).
- The Overlay is memoized like presence (`DataGridOverlays` does not memoize plugin overlays) and subscribes to the add-on store by a numeric `revision`.
- Pointer: the marker is `pointer-events-auto`; `click` opens the popover. Under `pointer-coarse:` the hit area grows to 24 px (the repo's touch target rule, WCAG 2.5.8) without growing the drawn corner; a touch browser test covers it. A press on the 8 px corner does not reach the cell: Shift/Mod-click and range drags that start on the corner, and the right-click context menu there, are lost. Docs name this; `Shift+F2` and the menu item remain.
- Pinned columns: `splitRectByPinZones` and `GRID_LAYER.pinnedOverlaySegment`. Pinned rows: browser test.
- Comments never trigger a view rebuild and never write core state.
- Measured plan (absolute metrics from the existing probes in `perf.browser.test.tsx` plus render-count guards): 100k rows with 20k comments scrolled by the probe; marker resolution for a 60-row window under 1 ms; one overlay render per scroll step; zero cell re-renders from a comment write; a local create commits one overlay update; controlled re-index of 10k comments under 5 ms and 100k under 50 ms, and an unchanged 100k-record prop compares under 50 ms; `propChange` runs in an effect, not during render; docs recommend a stable `comments` reference, and the scroll probe also runs controlled with an inline array. Stop the ccc daemon first; use `--maxWorkers=3` under load.

## 10. Comments popover, keyboard, accessibility

Popover:

- The shadcn `PopoverContent` is consumer-owned and passes no `anchor`. The add-on composes Base UI `Popover` (Root, Positioner with a virtual anchor, Popup) with semantic-token classes (copied from `components/ui/popover` because the shipped `PopoverContent` offers no anchor control; a one-line comment says so), and uses `Textarea`, `Button`, `Separator` from `components/ui`. The virtual anchor returns the rect of the popover's target cell (found by `{ rowId, columnId }`, not the active cell) and is created with a `contextElement` (the grid scroll element) so `autoUpdate` follows grid scroll. `openComments` calls `api.scrollTo` first. If the target cell leaves the rendered rows the popover closes and the draft stays. The cell-rect source is verified on the merged code (fallback: overlay geometry).
- In fetch mode the popover of a row whose comments are still loading shows "Loading comments…" (a polite status), and the composer waits; a failed fetch shows "Could not load comments" with a Retry control that refetches the row.
- Content: `role="list"` of comments in order; author name in `<bdi>` with a color chip, `<time dateTime>` formatted after mount with a pinned locale from `labels`, resolved state, text as a React text node in `<bdi>` with `white-space: pre-wrap; overflow-wrap: anywhere`. No linkification.
- Actions per comment: Edit, Delete (inline confirm, no browser dialog), Resolve/Reopen. Composer: textarea, counter near the limit, Submit, `Mod+Enter` submits.
- `role="dialog"`, non-modal, `aria-label` = column title plus the cell's text bounded to 60 characters (the text is empty on unloaded cells and is omitted then); never the view row number. Initial focus: the composer textarea when the cell has no comments and the user can write, else the popup itself (`tabIndex={-1}`), so screen readers read the list first and touch keyboards do not pop up. Pending writes: `aria-busy` and quiet "Saving"; failures: inline `role="alert"` with retry.
- Base UI closes the popover on focus-out and outside press. Drafts live in a separate slice of the add-on store per cell (new composer, edits), so keystrokes do not bump the overlay `revision`; they survive every close reason and clear on submit or explicit discard. At most 50 drafts are kept (least recently edited dropped), and the textarea has `maxLength = maxTextLength`. Escape closes the popover and keeps the draft; no two-step.
- Escape owners, innermost first: delete confirm (cancels the confirm), then the popover (an open edit stays as a draft). Escape and `Mod+Enter` are gated with `isComposingKey`.
- Focus: `finalFocus` is always set. Keyboard-opened: on close `api.focus()` only when focus is free (header dropdown pattern). Pointer-opened: no move unless focus fell to `body`. When a view change removes the row while focus is inside, focus goes to the grid.
- Document-level handlers are scoped to the grid instance. The popup carries `data-grid-comments-popup` and `data-grid-keep-focus` (so the active cell does not take focus back), is listed in `KEEP_RANGE_SURFACES`, and grid key handlers ignore it.
- `openComments` returns `boolean`: `false` for a target that is a hole, filtered out, or in a hidden column; otherwise it scrolls and waits up to 10 frames for the cell to render before it opens; if the cell is still not rendered, the request is dropped (development warning).
- Creating the first comment by pointer needs the context-menu item (the add-on has no other pointer path to an empty cell), so the demo, the pointer tests, and the install docs mount `DataGridContextMenu`; keyboard create (`Shift+F2`) and `openComments` work without it.
- `hideResolved` hides resolved-only markers and their announcer counts; the popover still lists every comment of its cell.
- Each comment's actions are named by label functions that include the author and time ("Edit comment by {name}, {time}"), so a screen reader does not hear identical buttons.
- Buttons and the composer show when `readOnly`, `currentUser`, and the default gates allow the action. When a custom gate is set, its action shows whenever `readOnly` and `currentUser` allow it, and the gate runs when the user acts; a refusal shows an inline message. Without `currentUser` or when read-only the composer is replaced by a hint.
- `openComments` returns `false` when the row id is not in the view (unknown id, another page, an unloaded scroll row); otherwise it makes the target the active cell (selection) before it opens, so focus return lands on it. Tab or Shift+Tab past the last or first control closes the popover and returns focus to the grid with `api.focus()`, so the browser's Tab continues from the grid (browser test). When the popover closes because the target left the rendered rows, focus inside the popup goes to the grid element with `preventScroll`, so the user's scroll position is kept.
- On touch, the marker's 24 px hit area sits inside the cell corner and swallows taps there only; the long-press menu works elsewhere (docs name the swallowed corner).
- Pending actions use `aria-disabled` so focus stays on the control. After an action removes the focused control (delete, edit submit), focus moves to the popup; after the composer submits, focus returns to the textarea.
- A marker click takes the `openComments` path, so the cell becomes active.
- When a remote change removes the focused comment, focus moves to the popup itself. Edit mode has a Cancel control that discards the edit; Escape closes the popover and keeps the draft.
- Command `openComments` has `when: ctx.row !== undefined`: it refuses holes and band rows. Viewing works when read-only; each write checks `readOnly` itself.

Keyboard map:

| Chord | Action | Check |
|---|---|---|
| `Shift+F2` | Open the popover for the active cell (compose when empty) | Exact-modifier match, no clash with `F2` (edit); no browser binding. macOS laptops need Fn, so the context-menu item is the second path. |
| `Shift+F10` / menu key | "Comments…" item from `getCommentMenuItems` | Existing menu keys. The item opens the popover after the menu has closed and returned focus (next animation frame), so the focus return does not close it; a browser test covers it. |
| `Mod+Enter` | Submit in the composer | Inside the portaled popup; grid handlers ignore it. |
| `Escape` | Close step | See Escape owners. |

Rejected: `Ctrl+Alt+M` (AltGr on Windows; Cmd+Option+M minimizes on macOS), `Mod+Shift+M` (browser reserved), `Alt+Shift+M` (dead on macOS, language switch on Windows). A docs row lists `Shift+F2`.

Screen readers:

- The announcer is a `role="status" aria-live="polite"` element portaled to `body` (core does the same for its live region, because inside `role="grid"` it fails the required-children rule). It empties its text before each announcement, so repeated text is read again. It announces only when focus is inside the owning grid or its comments popover, when the active cell becomes a commented cell: count, unresolved count, and the bound chord read from the keymap. Debounce 250 ms, so quick arrowing announces only where the user stops. Sanitized author names only. Remote changes to the open popover announce "Comment added by {name}".
- The marker is `aria-hidden` (D11). An axe test covers grid, marker, and announcer.
- The context-menu path exists when the app mounts `DataGridContextMenu`; docs say so.
- All strings from `labels`, with plural through a function.

## 11. Permissions and `readOnly`

Every write path (create, edit, delete, resolve, reopen, retry, "Save my version") runs in order: `readOnly` check (unless `allowWhenReadOnly`), `currentUser` present and valid, row-busy gate, `createId` (create only), `normalizeText` and bounds, gate, optimistic apply, `onCommentSave`; section 6 rule 8 repeats the checks after each `await`. A refusal before the optimistic write also fires `onCommentRejected` (reasons `"read-only"`, `"row-busy"`, `"limit"`, `"invalid"`, `"forbidden"`, `"error"`). Gates may be async; the UI shows the action pending and the store is re-read after the await. `applyRemote`, `fetchComments`, `removeComments`, and acknowledgement settling are not user writes and ignore `readOnly`. Without `currentUser` the popover is read-only and no warning fires. Defaults: edit and delete by the author, resolve by anyone, create by anyone. The server enforces authorization; the add-on displays `author` as given.

## 12. Undo, clipboard, export

- Undo/redo is outside the grid history (D6). The textarea keeps native text undo; the inline delete confirm is the safety net.
- Copy, cut, paste, and fill move cell values only. Comments stay on their cell. Docs say so.
- Export/import is not in v1. `getComments()` gives the app a bounded snapshot. A spreadsheet note export (legacy single-note format first, formula-like text neutralized, author names via an app callback) follows after a round-trip test with the `data-grid-io` dependency (Q4).

## 13. Registry shape and core touches

New folder `registry/default/blocks/data-grid-comments/`:

| File | Content |
|---|---|
| `data-grid-comments.ts` | barrel (section 4) |
| `types.ts` | public types |
| `comment-reducer.ts` | pure reducer and index; no React, no core change needed |
| `comment-store.ts` | zustand vanilla store per hook call: index, pending, drafts, tombstones, alias maps, fetch generations, LRU, `revision`, visible-rows field |
| `validate.ts` | record validation and coercion (remote, fetch, acknowledgement, props, seed) (`toSafeText`, bounds, author sanitizing, dev warn once per instance) |
| `create-id.ts` | `createId` default with fallback; `writeId` generator |
| `use-data-grid-comments.ts` | hook, plugin assembly, callback refs (assigned in an effect, not during render, so the compiler bail-out baseline stays unchanged), `applyRemote`, acknowledgement handling, `onDataChange` observer (a plain plugin function, no React) |
| `comments-overlay.tsx` | markers, rendered-row reporting |
| `comments-mount.tsx` | fetch scheduler, `saveStatus` watcher, announcer, popover host |
| `comment-popover.tsx` | popover content and composer |
| `menu-items.ts` | `getCommentMenuItems` |
| `labels.ts` | `DataGridCommentsLabels` and defaults |
| `registry/default/examples/data-grid-comments-demo-server.ts` | in-memory compare-and-swap server and channel; used by the model test and the demo (lands in batch 1) |
| `no-arg.type-test.ts`, `comments.type-test.ts` | `useDataGridComments()` compiles |
| `test/` | section 16 |

Also: `registry.json` items `data-grid-comments` (`dependencies: ["zustand@^5.0.15", "@base-ui/react@^1.8.0"]`, `registryDependencies: ["DammersCode/gridcn/data-grid", "button", "textarea", "separator"]`) and `data-grid-comments-demo`; `lib/registry-items.ts`; `components/registry-examples.tsx`; `public/r/` via `pnpm registry:build` and `node scripts/normalize-payload-eol.mjs`. The add-on imports only from core `data-grid/data-grid` and `data-grid-sdk`; `verify-registry-dependencies.mjs` must pass.

Core touches (additive; they collide with branches that edit the same files, so they come after the merge):

1. Keymap action `openComments`: `GridActions` in `types.ts`, `BUILTIN_ACTIONS` (and its JSDoc) and `PLUGGABLE_ACTIONS` in `keyboard/default-keymap.ts`, `PLUGIN_BOUND_ACTIONS` in `keyboard/index.test.ts`, an empty case in `use-grid-interaction.ts`, the warning text in `plugins.ts`; label and group via `GridCommand.label/group`.
2. `data-grid/data-attributes.ts`: `commentMarker`, `commentsPopup`; `KEEP_RANGE_SURFACES` in `use-grid-interaction.ts`; `GRID_ATTR` type tests.
3. Portaled events: the context-menu trigger and the root's touch context-menu suppression return early when the event target is outside `currentTarget` (portaled popup events bubble through React), so the comment textarea keeps its native menu (spell-check, Paste); browser test on desktop and touch.
4. `components/ui/textarea.tsx` if the saved-views branch has not landed it (identical shadcn file; either side wins a conflict).

Follow-up seam, recommended for 2.0 (Q3): a core per-cell description map like `cellErrors`, so screen readers get the comment hint on cell focus without a live region.

## 14. Client and server parity

The parity matrix gets one `comments` row with a cell per mode L, PC, PS, Z, C, SS, FS, API (`C` is app-owned sort/filter/search, `API` is `onDataChange` write-through); the row is mode-neutral like `presence` (`modeNeutral`). How comments arrive per data mode:

| Data mode | Comments source | Notes |
|---|---|---|
| Local client | `defaultComments` or `comments` | Full set in memory. |
| Pagination (client, server) | `comments`, or `fetchComments` for the page's rows | Fetch on page change. |
| Lazy / server scroll | `fetchComments` for rendered non-hole rows, or app-supplied | Evicted rows are never orphaned; hole rows skipped; plugin order `[...server.gridProps.plugins, comments.plugin]`; call `refetchComments` after a server refresh. |
| Controlled sort/filter/search | Unchanged | Keyed by ids. |
| `sortMode="server"` / `filterMode="server"` | Same as lazy | A re-sort moves markers only; a filter hides markers and keeps comments. |
| Own API / write-through | `onCommentSave` + `applyRemote` | Transport, auth, retry belong to the app. |
| Controlled comments + fetch | `fetchComments` answers through `onCommentsChange` | App owns eviction (section 5). |

Evidence: `tests/parity/comments.parity.test.tsx` (confirm on the merged line that gate 4's registry tests include `tests/parity`) and the docs page. `pnpm registry:verify` and `verify-parity` must pass; `data-modes.mdx` is regenerated with `verify-parity --write`.

Presence: comments do not import presence. `CommentAuthor.color` lets the app pass the presence color for the same user; the docs recipe shows both hooks sharing a user list.

## 15. Security and data protection

- Comment text is untrusted: React text nodes only, never HTML, no linkification, `toSafeText` before display; `normalizeText` output is re-bounded.
- `applyRemote`, `fetchComments` answers, and acknowledgement records are validated record by record into fresh frozen objects (copy each field once): string ids 1..128 without control characters, finite timestamps, integer version 1..1,000,000,000, bounded text and author fields, control and bidi-override characters stripped from names. Malformed records are dropped with one dev warning per instance. Batch and answer sizes are capped before parsing; the verdict reports counts, with at most 100 listed entries.
- `writeId` is generated inside the add-on with crypto randomness, so a peer cannot forge an echo.
- Author spoofing is the app's job: the server sets `author` from the session.
- Free text can hold personal data. The docs carry a callout: retention, erasure, and access control belong to the app. The add-on stores nothing outside memory and the app's `comments`. Tombstones carry no text.
- Rate limits and abuse control belong to the app; the add-on bounds only local state. Over-cap remote records are dropped in arrival order; apps keep sets inside the caps.
- `createId` falls back when `crypto.randomUUID` is missing (plain-http hosts).
- No secret or personal data in tests, fixtures, or docs.

## 16. Test plan

- Unit (`--project unit`): every reducer (state, event) pair, validation and bounds, tombstone TTL (injected clock), row-id alias map, rejection draft folding, `applyRemote` verdicts, index build and controlled last-emitted base, LRU protecting pending/draft/conflict/open, fetch generations and live log, row-busy gate (saving, failed, swap), `no-arg` type test.
- Model test: section 6, in the unit project.
- Browser (`--project browser`, with the browser lock): `hideResolved`, the 24 px touch hit area, `openComments` false cases, `allowWhenReadOnly`, custom gate visibility, `removeComments`, `refetchComments`, the menu path opens the popover after focus return; markers after sort/filter/hide/pin/pinned rows; pointer and keyboard create/edit/delete/resolve/reopen; `Shift+F2` and the menu path; hole rows refused; focus return rules; Escape order; draft survives outside press and focus-out; conflict UI; announcer text, debounce, portal, and focus gating; axe over grid, marker, and announcer; row-delete callback incl. history and rollback; id swap re-keys markers and an open popover; a saving row refuses the comment write with a visible hint; eviction keeps pending comments; two grids on the in-memory server see the same comments and a forced conflict is visible; two grids on one page do not cross-talk; `readOnly` blocks every write path; forced-colors marker.
- Also: `openComments` dropped after 10 frames and `false` for ids not in the view (unknown, another page, an unloaded scroll row); fetch-mode Loading and Error popover states, RTL marker corner, focus after a remote removal and after own actions, a guard that typing renders no overlay, the development warning for a `stale` rejection without `current`, scroll-out close with `preventScroll`, the right-click menu inside the textarea (desktop and touch).
- Perf: section 9, including the 100k-row scroll with 20k comments.
- Parity test per mode (section 14). Visual check at `--radius 0` and `1rem`, tinted primary, larger font.
- Security: hostile strings (markup, null-prototype values, long text, control and bidi characters), hostile `applyRemote` and fetch answers.
- Gates before commit follow AGENTS.md (`pnpm lint` already runs `verify-skills` and `verify-parity`), then the CI mirror and `pnpm test:e2e-install`.

## 17. Docs, demo, skills, changelog, glossary

- Page: mode-neutral like presence, so it follows the presence precedent in Server > "Rows and live data" (seventh page, at target). Presence's sibling pages are Task pages: this one is a Task page ("Add comments to cells", 200–800 words, numbered steps, demo before the first H2). Options go on a Reference page in Add-on options (`options-comments`, props tables and the callback matrix), with an example page. Frontmatter per `research/docs-navigation-ruleset.md`. Ruleset S14 and section 6 question server-area placement for mode-neutral add-ons (Q6).
- The ruleset Task template wins over the AGENTS.md add-on page structure once the docs rewrite lands; reference-style content moves to the options page. Hand-written places: the topic page, the options page (Add-on options > Server), the example page, plus two forced edits outside ruleset S16: the chord row in `plugins.mdx`, one line on the context-menu page, and the terms in `content/docs/terms.mdx` (hand-written); a presence-sharing recipe is optional.
- Written with the `simple-english` skill and AGENTS.md page structure; `<NewBadge />` rules apply, including `plugins.mdx` ("Six built-in actions are pluggable" becomes seven), the plugin-chord rows in `plugins.mdx` (`<KeymapTable />` is generated from `DEFAULT_KEYMAP` and does not list plugin chords), and the context-menu page for the resolver.
- Demo `data-grid-comments-demo` (the in-memory server lives in `registry/default/examples/data-grid-comments-demo-server.ts`, listed in the demo's registry files; the model test imports it from there): a grid with comments and a simulated second user over an in-memory channel (latency, a toggle that forces a stale conflict, an offline switch), in the site style, registered in `components/registry-examples.tsx`, `app/dev/examples/page.tsx`, the `DEMOS` list in `demo-smoke.browser.test.tsx`, and `demo-fit.browser.test.tsx`; the lazy example shows `[...server.gridProps.plugins, comments.plugin]`.
- Glossary (`GLOSSARY.md`, mirrored in `content/docs/terms.mdx`): comment marker (distinct from row marker), address, comments popover, optimistic write, unresolved comment, resolved comment, draft, conflict, orphaned comments, write id, tombstone, echo. The glossary entries "save", "save acknowledgement", and "save status" are widened to cover comment saves (`onCommentSave`); prose says "refused" or "reverted" for rejections. Prose uses the glossary words: "gate" for a hook that can refuse, "save acknowledgement" (code names may keep `Ack`), "write" not "mutation", "rendered rows" not "windowed", no "op". Run `verify-vocabulary.mjs`.
- Skills: `skills/gridcn-addons/SKILL.md` (table row, wiring note, and the `description` frontmatter line), `skills/gridcn-data-source` if server wiring is mentioned, `node scripts/sync-skills.mjs`; `verify-skills.mjs` compiles snippets.
- `CHANGELOG.md` under `## Unreleased`: the add-on and the core `openComments` action.

## 18. Timing and dependencies

On `origin/release/2.0` (257c1976) already: plugin contract (`Overlay`, `Mount`, `onDataChange`, `keymap`), Overlay ctx, hole helpers (`holeRowId`, `rowIdAtViewRow`), `data-grid-server`, `SaveAck` with `current`, `saveStatus` and `useDataGridRowSaveStatus`, `research/parity-matrix.json` and `verify-parity.mjs`.

Not there yet:

| Contract | Branch | Needed for |
|---|---|---|
| `source: "id-swap"`, `actions.replaceRowId(s)` | write path (branch `w2-write-path-faed6d`: `store/data-write.ts`, `store/types.ts`) | section 6 rule 12 (rule 11 needs only `saveStatus`) |
| `components/ui/textarea.tsx` | saved-views | composer |
| Docs ruleset and navigation | docs rewrite | page placement and frontmatter |
| Edits of `types.ts`, `data-attributes.ts`, `labels.ts`, `data-grid-sdk.ts`, `store/types.ts`, `root.tsx` (and `maxLoadedRows`) | lazy-gaps and write path | the core touches (conflict risk) |

The add-on does not use `maxLoadedRows` or `reshape()`; it needs nothing from lazy-gaps beyond what is on release/2.0.

Can start before the integration merge (new folder only, no core change; `validate.ts` uses `toSafeText` from the SDK): `types.ts`, `comment-reducer.ts`, `comment-store.ts`, `validate.ts`, `create-id.ts`, `labels.ts`, the hook with `applyRemote` and acknowledgement handling, the overlay markers and perf test on release/2.0, the delete observer, the fetch scheduler and LRU, the menu helper, the model tests and the parity test file (only the matrix row needs the docs page path as evidence, so the row lands with batch 7), the popover except the textarea.

Must wait: the id-swap branch of the observer; the core touches; the composer textarea; docs pages (ruleset); the final payload rebuild, skills sync, and changelog.

## 19. Effort and commit plan

Size: large add-on, about 3,000 source lines and 3,000 test lines, 7–9 working days. Batches (each green on all gates, pushed in logical batches only):

1. `feat:` pure reducer, store, validation, ids, labels, in-memory server, model tests.
2. `feat:` hook, plugin shell, `applyRemote`, acknowledgements, observer (delete; the id-swap branch lands after the write-path merge), row-busy gate.
3. `feat:` overlay markers, rendered-row reporting, perf test.
4. `feat:` core touches (keymap action, attributes, portaled-event guards, textarea), with the changelog lines, the `plugins.mdx` edit with its badge, and the `data-grid` and `data-grid-context-menu` payload rebuilds in the same commit.
5. `feat:` popover, composer, drafts, command, menu resolver, announcer, browser tests.
6. `feat:` `fetchComments` scheduler, LRU, parity tests.
7. `docs:` demo, pages, parity row, glossary, skills, changelog, payloads, e2e install.

## 20. How to implement

1. Create the folder; write `types.ts`, `comment-reducer.ts`, `validate.ts` with tests first; the reducer table drives the tests.
2. `comment-store.ts`; model test with the in-memory server (reused later by the demo).
3. Hook modeled on `use-data-grid-presence.ts` (store per call, plugin built once, callbacks through refs, stable plugin identity). The observer is the plugin's `onDataChange` function.
4. Overlay: reuse presence placement, clamp, and pin-split code; `useShallow` over `rowIdAtViewRow`; memoize; layout-effect reporting; perf test.
5. Core touches in one commit.
6. Popover on Base UI with a virtual anchor and `contextElement`; verify the cell-rect source and `finalFocus` early; drafts in the store.
7. Fetch scheduler and LRU; parity test.
8. Demo, docs, skills, glossary, changelog, registry build, payload normalization, `pnpm test:e2e-install`.

## 21. Risks

- No per-cell description for screen readers in v1; the announcer is the only mitigation until the Q3 seam (WCAG 1.3.1).
- Equal-version ties from a transport without compare-and-swap resolve by `updatedAt`; docs tell apps to stamp it on the server.
- Expired tombstones can let a very late old upsert resurrect a comment until the next fetch.
- Controlled mode with huge arrays costs O(n) per changed content; the perf budget bounds it.
- The virtual-address popover depends on Base UI's anchor API and the cell-rect source; step 6 verifies it.
- Core touches collide with the lazy-gaps branch if done early.
- The conflict model has many rules; the model test is the guard and must land with the reducer.
- An app that pushes many rows through `applyRemote` can fill the store to `maxComments` and block local creates; apps push only relevant rows.

## 22. Open questions for the owner

- Q1. Should a `readOnly` grid still allow comments by default? Spec: no (`allowWhenReadOnly: false`).
- Q2. `Shift+F2` as the only chord, plus the context-menu item. Accept?
- Q3. Add the core per-cell description seam to 2.0 (recommended), or keep the announcer for 2.0 and add the seam later?
- Q4. Spreadsheet note export in 2.0 or after?
- Q5. Summary-only fetch (counts without bodies) in v1 or later?
- Q6. Docs group: seventh page in "Rows and live data" (presence precedent) or a mode-neutral group?
- Q7. Default bounds (2,000 characters, 50 per cell, 50,000 total) acceptable?
- Q8. One `onCommentSave`, or the four named callbacks of the issue sketch as sugar on top? Same for the ctx-object gate shape and the batch `applyRemote`.
- Q9. Is a marker filter enough for "unresolved comments only", or does 2.0 need a row filter (core filter predicate)?
- Q10. The client `id` is the permanent key and the server must keep it (D13). Is that acceptable, or must server-assigned comment ids be supported (alias map, more rules)?

## 23. Review log

Eight review rounds ran with fresh reviewers. Round 8 had no blocker. Its two major findings (same-version ties on a last-writer-wins server; the split between a superseded and a confirmed `void` acknowledgement) and the factual errors were fixed in the spec. Known nits left for the reducer test table and implementation review:

- The thrown `writeId` lifetime and the Discard path need a table row each.
- Fire-and-forget transports can still lose a comment to absence removal after the 30 s exemption; docs should say fetch-based absence removal needs a save-ordered transport.
- Controlled mode with a very large unchanged `comments` prop costs a comparison per render; the docs recommendation (stable reference) is the real fix.
- The ruleset Task page cannot hold every behavior note; implementation decides which notes move to the options page.
- Round 8 reviewer notes list further wording-level items in `comments-review-r8-a.md` and `comments-review-r8-b.md`.

## 24. Implementation notes (deviations from the review-8 draft)

- The reducer keeps its rules but mutates its state in place and stays deterministic (time and ids arrive in the event). Copying 100k records per event would break the cost budget. `comment-engine.ts` (new, no React) holds writes, gates, the fetch scheduler, the observer, and callback dispatch; `use-data-grid-comments.ts` is a thin hook over it, and the model test drives the engine directly.
- Measured budgets for the controlled prop: an unchanged 100k-record prop compares in under 50 ms, a rebuilt equal 100k array under 100 ms, and 10k changed records re-index in under 150 ms (validation included). The 5 ms figure of section 9 was not reachable.
- The popover renders through a portal to the body, because Base UI leaves an `aria-owns` span at its React position and inside `role="grid"` that span fails the required-children rule.
- A mounted cell is not enough to keep the popover open: the active row stays mounted off-window, so the popover also closes when its cell no longer overlaps the scrollport.
- Initial focus is the composer only when the cell has no comments; otherwise it is the popup.
- The menu item uses `onClick` (the context-menu spec shape); the resolver is generic over the host's item type and appends a separator and the item.
- `{ comment: null }` for a delete carries no version, so the client tombstones at `baseVersion + 1`. A server that bumps versions past that heals through the next fetch.
- An own-write grace of 30 s applies only while the confirmed record is still that write; any later remote or fetched record clears it.
- The compiler bail-out baseline gains `OpenPopover` (a Base UI anchor object reads the scroll element lazily).
