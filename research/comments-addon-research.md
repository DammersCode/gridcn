# Research: cell comments add-on

Status: research input for a spec. No decision is final here.

Scope: comments anchored to one cell by row id + column id, a flat list per cell with a resolved
state, optimistic multiplayer sync where the app owns transport and persistence, and grids with
virtualized, lazy, or server-paged rows up to 100k+ rows.

Sources are labelled generically; standards-body URLs are in [Sources](#sources). Vendor docs were
read for behavior only and are not named.

---

## 1. Anchor model

### Findings

- Spreadsheet vendor docs: a comment thread is tied to exactly one cell; adding to a multi-cell
  range throws. The anchor is a cell address that the spreadsheet engine rewrites on row/column
  insert, delete, and move, because the engine owns the structure.
- Spreadsheet file format (threaded comments extension): the root comment carries `ref` (an A1
  cell reference); replies omit `ref` and point to the root with `parentId`. The anchor is
  positional and only stays correct because the writer rewrites it on save.
- Document-collaboration API docs: the `anchor` field is an opaque, app-defined JSON string that
  the service stores but cannot resolve. Anchors are immutable, and their position is not
  guaranteed across revisions; the docs recommend anchors only for content that does not change.
  Comments the service cannot place are shown as unanchored ("all comments" list) rather than lost.
- W3C Web Annotation Data Model: an annotation has a `target` with one or more `selector`s
  (quote, position, fragment). Several selectors are alternatives that describe the same segment,
  so a client can re-anchor with a fallback when one fails. Robust anchoring = redundant
  descriptions, not one fragile one.
- RFC 7111 (CSV fragment identifiers) addresses cells by `row=`/`col=`/`cell=` position. Any
  sort, filter, insert, or delete moves the target; a positional anchor without an engine that
  rewrites it is wrong after the first reorder.

### Anchor by stable id vs position

| Model | Survives sort / filter / move | Survives row delete | Needs |
| --- | --- | --- | --- |
| View index (row number in the view) | No | No | Nothing; breaks on every view rebuild |
| Data index | Sort/filter yes, insert/delete no | No | Index rewrite on every structural write |
| Row id + column id | Yes | Becomes orphaned, detectable | Stable `getRowId` and column ids |
| Id + redundant fallback (id plus a value snapshot) | Yes | Re-anchoring possible | Extra stored data, matching rules |

The grid already anchors long-lived state (active cell, checked rows, ranges, edit session) by row
id and column id because view-index anchors moved state onto other records (repo review lessons).
Comments are the same class of state.

### What happens to the anchor

| Event | Row id + column id result | Options |
| --- | --- | --- |
| Row sorted, moved, regrouped | Stays on the record | None needed |
| Row filtered out | Comment exists, no rendered cell | Keep; count it in a "comments in hidden rows" total; never delete |
| Column hidden | Same as filtered | Keep; optional per-row marker on the row header |
| Row not loaded (lazy hole, server page) | Unknown until the row arrives | Keep in store by id; render when the row id appears |
| Row deleted | Orphaned | (a) cascade delete, (b) orphan list, (c) tombstone with `detachedAt`, (d) re-anchor to neighbor |
| Column removed or renamed id | Orphaned | Same as row delete; renamed ids need an app-side map |
| Row id changes (temp id to server id after create) | Orphaned unless mapped | App remaps (`remapRowId(old, new)`), or the store accepts an alias |

- Re-anchoring to a neighbor (d) guesses the user's intent and is wrong for tabular data: the
  neighbor row is a different record. Documents re-anchor because text is continuous; rows are not.
- The grid cannot tell "deleted" from "not loaded" in lazy or server modes: a missing row id is
  normal there. Only the app knows a row was deleted.

### Trade-offs

Cascade delete is simplest but destroys discussion that may be the audit trail for the deletion.
An orphan list preserves it but needs UI. Detection in the grid is cheap only for client-side
full data; in lazy/server modes the grid must never auto-orphan.

**Recommendation:** anchor by `{ rowId, columnId }` only; never infer deletion in the grid; expose
orphans as data (comments whose anchor the app reports gone) and leave cascade vs keep to the app.

---

## 2. Thread vs flat list; resolve semantics

### Findings

- Spreadsheet vendor docs: one thread per cell; replies are a flat ordered list under the first
  comment; `resolved` is a thread property and a reply's `resolved` is read-only and mirrors the
  thread. Resolve and reopen are both supported (set `true`/`false`).
- Spreadsheet file format: per-comment `done` flag and `parentId`; in practice one level deep
  (root + replies).
- Document-collaboration API docs: resolve is a reply with `action: "resolve"`; the `resolved`
  field is read-only and derived. This keeps an audit trail of who resolved and when, in the same
  list. Only the author may edit or delete a comment or reply.
- ARIA 1.3 draft `comment` role: replies nest by DOM containment; `aria-details` links the
  annotated element to one or more comments.

### Options

1. Flat list per cell, resolved per cell (thread flag stored once).
2. Flat list per cell, resolved per comment; the cell is open while any comment is open.
3. Tree (reply-to-reply).
4. Resolve as an event entry in the list (`kind: "resolve" | "reopen"`).

### Trade-offs

- A per-cell flag (1) needs a separate synced entity (the thread) with its own version and its
  own conflicts, and its own lifecycle when the last comment is deleted.
- Per-comment state (2) keeps one record type. "Resolve" sets `resolved` on every open comment in
  the cell; a new comment arrives open and so reopens the cell. Concurrent resolve + new reply
  converges without a merge rule: the new reply is open, so the cell is open, which is the safe
  outcome.
- A tree (3) adds layout, focus order, and export mapping cost for a cell-sized popover; formats
  and tabular UIs use one level.
- Event entries (4) give an audit trail for free but grow the list and make "is it resolved" a
  fold over history.

### Who may resolve

Common practice: anyone who can comment may resolve or reopen; only the author edits; the author
or a moderator deletes. Resolve is reversible, so a broad permission is low risk.

**Recommendation:** flat list per cell, `resolved` per comment with cell state derived ("open if
any comment is open"), resolve/reopen as bulk writes over the cell's comments, default
"anyone who can comment may resolve".

---

## 3. Ordering and id generation

### Findings

- RFC 9562: UUIDv7 = 48-bit Unix ms timestamp + random bits; byte-sortable; recommended over
  v1/v6; optional monotonic counter within one ms (§6.2). Security: the timestamp leaks creation
  time; UUIDs are not access tokens and must not be treated as unguessable (§8); random bits from
  a CSPRNG (§6.9).
- IETF httpapi draft (Idempotency-Key header, draft 08, active, not an RFC): the client generates
  the key (UUID recommended); reuse with a different payload is an error (422); a retry while the
  first request runs is a conflict (409); servers expire keys and should publish the policy.
- Lamport 1978: wall clocks across clients do not order events; a logical counter does.

### Options

| Id source | Pro | Con |
| --- | --- | --- |
| Server-assigned | Authoritative, short | Optimistic UI needs a temp id and a remap step |
| Client UUIDv4 | No remap, idempotent create | Not sortable |
| Client UUIDv7 / ULID | No remap, roughly time-sortable | Leaks creation time; clock skew across clients |
| Temp id + server id | Server keeps its key scheme | Every reference (open popover, focus, pending edit) must follow the remap |

Ordering: client time is skewed and user-editable; server receive time is authoritative but
unknown until acknowledged. A display order of `(createdAt, id)` with `createdAt` replaced by the
server value on acknowledgement is stable and deterministic; a pending comment sorts last.

### Trade-offs

A client-generated id doubles as the idempotency key for the create, removes the remap path, and
makes echo suppression trivial (section 5). The cost is trusting the client for uniqueness, which
the server enforces with a unique constraint anyway.

**Recommendation:** the add-on generates `crypto.randomUUID()` ids by default with an app override
(`createId`); the id is the create's idempotency key; sort by `(createdAt, id)` with server time
winning once known.

---

## 4. Optimistic update and conflict resolution

### Findings

- RFC 9110 conditional requests: `ETag` + `If-Match` make a write conditional on the version the
  client saw; a mismatch returns 412 Precondition Failed; this prevents the lost-update problem.
  RFC 6585 adds 428 Precondition Required for servers that demand a condition.
- CRDT literature (comprehensive study, INRIA RR-7506): state-based and operation-based
  replicated types converge without coordination. A last-writer-wins register is the simplest;
  an observed-remove set handles add/remove; deletes usually need tombstones.
- Text CRDT / OT: character-level merging of concurrent edits to the same text. Built for long
  documents edited by many people at once.

### Options for comments

| Strategy | Fit for a comment body | Fit for `resolved` | Library cost |
| --- | --- | --- | --- |
| Version check (CAS, If-Match) | Good: edits are rare, author-only | Good | Small: a `version` field and a rejection path |
| Last-writer-wins by server order | Acceptable: loses a concurrent edit silently | Good | Smallest |
| Operation-based / CRDT | Overkill: one author, short text | Overkill | Large: a dependency or a sequence type |
| Three-way merge (diff3 on text) | Rarely useful; one author per body | N/A | Medium; produces conflict markers users must fix |

- Concurrency per record is low: only the author edits the body. The realistic conflicts are the
  same author in two tabs, resolve vs reopen by two users, and edit vs delete.
- Create never conflicts when the client owns the id.
- Delete vs edit: remove-wins is the safe rule; an edit to a deleted comment is dropped.
- Resolve vs reopen: either order is valid; server order decides (LWW) and both users see the
  final state.

### Stale-write rejection UX

- Body edit rejected as stale: keep the user's draft in the editor, show the newer text, offer
  "replace with mine" (retry with the new version) or "discard mine". Never drop typed text.
- Resolve rejected: apply the server state, announce it ("Comment reopened by another user"); no
  dialog for a one-click toggle.
- Any rejection (permission, validation, network) rolls back the optimistic record to the last
  confirmed state and leaves an error on the record, so the UI can show "not saved — retry".

**Recommendation:** per-record `version` with compare-and-swap semantics owned by the app's
transport; the add-on keeps confirmed and pending state per comment, rolls back on rejection, and
keeps drafts on stale edits; no CRDT.

---

## 5. Echo suppression, idempotency, delivery order

### Findings

- A transport that broadcasts every change to every client also returns the writer's own change
  (echo). If the client applies it as a new remote change, it double-renders, re-animates, or
  overwrites a newer local pending edit.
- Delivery over sockets, polling, or retries can duplicate and reorder messages. Lamport: without
  a counter on each record, "newer" cannot be decided.
- Document-collaboration API docs: deleted comments stay as records with `deleted: true` and no
  content, and list calls can include them (`includeDeleted`). A tombstone is what lets a late
  "update" or a replayed "create" be recognized as stale.

### Model for `applyRemote` / `onLocalChange`

- `onLocalChange(change)` fires for every local write with `{ type, comment, baseVersion,
  mutationId }`. The app sends it and later calls `applyRemote` with the server's result.
- `applyRemote(records)` takes full records (state-based), not operations. Rule per record:
  - unknown id → insert (unless a tombstone with a higher or equal version exists);
  - known id, `incoming.version > known.version` → replace confirmed state;
  - `incoming.version <= known.version` → drop (duplicate or out of order);
  - incoming matches a pending local mutation (`mutationId` or same id + version) → confirm the
    pending entry, no visible change (echo);
  - `deleted: true` → keep a content-free tombstone `{ id, version, deletedAt }`.
- State-based records with a monotonic per-record version make apply idempotent and commutative
  per record, so duplicates and reordering converge without a global clock.
- Tombstones grow without bound. Evict a tombstone after the app's acknowledgement window (for
  example once it leaves the loaded window, or after a TTL); a resurrected record after eviction
  is then the app's server bug, not the client's.
- Causality across records (a reply before the comment it answers) does not arise in a flat list
  with per-record versions; it does in a tree, which is another reason for flat.

**Recommendation:** state-based `applyRemote(records)` with per-record monotonic `version`,
`mutationId` for echo matching, drop on `version <=`, content-free tombstones with bounded
lifetime.

---

## 6. Loading comments for large and virtualized sets

### Findings

- Document-collaboration API docs: list is paged by `pageSize` + `pageToken` (cursor), and
  `startModifiedTime` gives incremental sync ("changed since"). Cursor paging stays correct while
  records are added; offset paging skips or repeats.
- A grid of 100k rows with comments on 1% of cells still holds thousands of threads; bodies are
  free text of unbounded size. Markers need far less than bodies.

### Options

1. Load everything up front (small client-side grids).
2. Summaries for the whole grid (`{ rowId, columnId, count, openCount }`), bodies on open.
3. Summaries per rendered rows: fetch for the row ids in the rendered range + overscan, debounced
   on scroll, keyed by row id.
4. Bodies prefetched for the active cell only.

### Trade-offs

- (2) is cheap when the summary set is small (bytes per commented cell) and gives correct totals
  for filtered-out rows; it fails for very large sets.
- (3) matches lazy and server-paged rows, which already fetch per range; the comments request can
  ride the same range. Totals for unloaded rows are unknown, so a grid-wide "N open comments"
  needs a server count.
- Cache eviction: bound the number of cached threads (LRU); never evict a thread that is open,
  has pending writes, or holds an unsent draft; evicting summaries for rows that left the
  rendered range is safe if the next scroll refetches.
- After each `await`, drop the response if a newer request for the same range or a changed row
  set replaced it (repo review lesson).

**Recommendation:** two levels — a summary per cell (`count`, `openCount`) that drives markers, and
thread bodies that load on open; the add-on accepts summaries pushed by the app and exposes a
`loadThread(cell)` callback plus the rendered row ids, and leaves the range fetching to the app.

---

## 7. Permissions

### Findings

- Document-collaboration API docs: only the creator edits or deletes; others get errors; clients
  check an `author.me` flag before offering the action.
- Spreadsheet vendor docs: comments created through the API are attributed to the current user;
  the author cannot be set by the caller.
- OWASP API Security Top 10 (2023): broken object level authorization (API1) and broken object
  property level authorization (API3) — a client that can set `authorId` or edit another user's
  record is the classic failure. Client checks are UX only.

### Options

| Gate | Shape | Trade-off |
| --- | --- | --- |
| Static flags | `readOnly`, `canComment` | Simple; no per-record rules |
| Sync predicate | `can(action, comment, user) => boolean` | Per-record rules, runs on render; must be cheap |
| Async gate | `onBeforeWrite(change) => Promise<boolean>` | Real server check, but blocks the UI or flickers; duplicates the server's authority |
| Optimistic + server rejection | Write, roll back on reject | No extra round trip; brief false success on a forbidden write |

Default rule set: comment = anyone not `readOnly`; edit body = author; delete = author or
moderator; resolve/reopen = anyone who can comment. The grid's `readOnly` blocks every write path
(create, edit, delete, resolve, import) — repo review lesson.

**Recommendation:** a sync `canComment`-style predicate per action for affordances, defaults as
above, `readOnly` blocks all writes, and the app's server remains the authority (rejections roll
back through section 4).

---

## 8. Accessibility

### Grid pattern constraints (WAI-ARIA Authoring Practices, grid)

- Every cell is focusable or contains one focusable element; one tab stop for the whole grid;
  arrow keys move between cells.
- Enter or F2 enters a cell's widgets; Escape (or F2 again) restores grid navigation.
- A focusable marker inside every commented cell adds a second focus target per cell and fights
  the existing Enter/F2 edit gesture. The cell itself stays the focus target.

### Marker exposure

- Visual: a corner indicator. WCAG 1.4.1 Use of Color: color must not be the only signal (open
  vs resolved needs a shape or icon difference, not only hue). WCAG 1.4.11 Non-text Contrast:
  the indicator needs 3:1 against the cell background in every theme, including selected and
  active cell backgrounds.
- Screen readers: the indicator is decorative (`aria-hidden`); the cell exposes the fact in text,
  for example a visually hidden suffix or `aria-describedby` to a shared element ("2 comments,
  1 open"). `aria-description` is ARIA 1.3 draft; `aria-describedby` is the stable 1.2 option.
  The ARIA 1.3 draft `comment` role plus `aria-details` is the semantic target, but support is
  unverified, so it is an addition, not the only path.
- ARIA 1.2 allows `aria-haspopup` and `aria-expanded` on `gridcell`. Setting them only on
  commented cells is valid; on every cell it is noise for each cell the user passes.

### Popover: disclosure vs non-modal dialog

| Pattern | Fits | Problem |
| --- | --- | --- |
| Tooltip / hover card | Read-only preview | WCAG 1.4.13: must be dismissable, hoverable, persistent; cannot hold a text field |
| Disclosure | Show/hide inline content | Content is in the reading order after the trigger; a grid cell cannot hold it |
| Non-modal dialog | Thread with a text field and buttons, outside the grid DOM | Needs explicit focus rules (below) |
| Modal dialog | Long editing | Blocks the grid; heavier than the task |

- `aria-haspopup="dialog"` requires the popup to have `role="dialog"` (MDN); pair with
  `aria-expanded` and `aria-controls` while open. A labelled dialog (`aria-labelledby` naming the
  cell, for example "Comments on Price, row 12").
- Focus (Authoring Practices, dialog): on open, focus moves into the dialog (the reply field, or
  the first comment when reading); Escape closes; focus returns to the invoking element, or to
  another logical element if it is gone. In a virtualized grid the invoking cell may have
  scrolled out and unmounted: return focus to the cell by row id + column id after scrolling it
  into view, and only when the keyboard opened the popover and the user did not click elsewhere
  meanwhile (repo review lesson).
- Non-modal: Tab may leave the dialog; the dialog stays open until Escape, an explicit close, or
  the user moves the active cell (decide one rule and document it).
- WCAG 2.4.11 Focus Not Obscured (Minimum): the popover must not cover the focused cell; anchor it
  beside the cell and flip at edges.
- WCAG 2.4.7 Focus Visible: the active cell ring and the dialog controls keep visible focus.

### Announcements (WCAG 4.1.3 Status Messages)

- Remote changes (new comment on the active cell, resolved by someone else, save failed) are
  status messages: announce through the grid's existing polite live region, debounced, latest
  wins (the repo already has one region; add no second region).
- Announce only for the active cell or the open thread; never for remote changes in unrelated
  cells (a busy sheet would flood the region).

### Keyboard (WCAG 2.1.1) and chord choice

- Authoring Practices: avoid modifier + Tab/Enter/Space/Escape, Meta + single key, Alt + function
  key; avoid Caps Lock/Insert/Scroll Lock combinations (screen reader keys); on macOS avoid
  Control + Option (the screen reader's VO keys). Shortcuts supplement navigation; they never
  replace it, so the popover also opens from the cell context menu.
- The common document-editor chord for "insert comment" is Ctrl+Alt+M / Cmd+Option+M:
  - on Windows Ctrl+Alt is AltGr; AltGr+M types a character on several layouts (µ on German);
  - Cmd+Option+M is the OS "minimize all windows" chord, and in one major browser it toggles
    responsive design mode; Ctrl+Shift+M is that mode on Windows/Linux.
- Shift+F2 is the spreadsheet convention for a cell note; it fits beside the grid's F2 edit key
  and has no browser devtools binding found in the browser shortcut docs checked. macOS laptops
  need Fn for function keys, so it needs the context-menu path as well.
- The grid's keymap add-on lets the app rebind; document the chord in the shortcuts table.

### Pointer target (WCAG 2.5.8)

A corner triangle of a few pixels fails the 24×24 CSS px minimum unless an exception applies.
The "equivalent" exception covers it when the same action exists elsewhere (context menu item,
shortcut, a hover button sized 24 px). Clicking the cell must keep selecting the cell; the marker
must not steal the press.

**Recommendation:** cell stays the focus target, marker is `aria-hidden` with text on the cell,
thread opens in a labelled non-modal `role="dialog"` from Shift+F2 and the context menu, focus
returns by cell id, remote changes announce only for the active cell through the existing region.

---

## 9. Rendering markers on virtualized rows

### Findings (repo constraints)

- Display cells are plain elements with `role` and `aria-*`; a mounted control in every cell
  doubled scroll cost (repo review lesson).
- Only rendered rows have DOM; at 100k rows the marker cost must be O(1) per rendered cell and
  zero for uncommented cells.

### Options

| Technique | Cost per rendered cell | Notes |
| --- | --- | --- |
| Lookup map `rowId → columnId → summary` | One `Map.get` pair | Store-level; no per-cell subscription |
| Per-cell selector subscription | One subscription per cell | Re-render only the changed cell; subscription churn on scroll |
| Row-level selector (`summary for rowId`) | One per row | Row re-renders when any of its cells changes; fewer subscriptions |
| CSS pseudo-element (`::after`) via data attribute | Zero extra DOM | Visual only; screen reader text still needed |
| Overlay layer positioned by cell geometry | Zero DOM inside cells | Must track scroll and column widths; harder with pinned columns |

- A data attribute (`data-comments="open" | "resolved"`) plus a CSS corner keeps the cell DOM
  unchanged when there is no comment and adds no element when there is one; the hidden text for
  screen readers can live in a single shared element referenced by `aria-describedby`.
- Store updates from `applyRemote` must not rebuild the view: comments are not row data, so they
  never trigger sort, filter, or search recomputation.
- Rows without a row id (lazy holes, band rows) render no marker and skip lookups (repo lesson).

**Recommendation:** comment summaries in a separate store slice keyed by row id then column id,
read with a row-level selector, rendered as a data attribute + CSS corner plus shared hidden text;
no per-cell component.

---

## 10. Export and import

### Findings

- Spreadsheet file format: two comment kinds coexist. Legacy cell comments ("notes": author name,
  text, one per cell) are in the core standard (ECMA-376). Threaded comments are a vendor
  extension: per-sheet `threadedComments` part, a workbook-wide persons part (`personId` is a
  GUID that must match a person entry), attributes `ref`, `dT`, `id`, `parentId`, `done`. Writers
  also emit a legacy comment per thread so older readers see text.
- The repo's xlsx dependency declares both `comment` (author, text) on a cell and
  `threadedComments` + `persons` types. Whether it writes both parts correctly needs a round-trip
  test before the spec relies on it.
- OpenDocument spreadsheet: an `office:annotation` element can sit inside a table cell with
  creator, date, and text (implementation notes; section numbers unverified against OASIS text).
- CSV (RFC 4180) has no metadata; comments need an extra column or a second file.
- Document-collaboration API docs: author identity is part of every record; export copies names
  (and in the threaded format, person entries with provider ids) into a file outside the app's
  access control and retention.

### Privacy and safety on export

- Comments are personal data (author, timestamps, free text). An export leaves the app's erasure
  and retention controls (section 11). Default: comments are not exported; the app opts in.
- Map authors through an app callback (`authorName(comment)`), never export raw user ids or
  emails by default.
- CSV and xlsx text: neutralize formula-like text (`=`, `+`, `-`, `@`, tab, CR) in comment bodies
  the same way as cell values (OWASP CSV injection; repo security rule).
- Import: bound comment count, body length, and persons list before parsing (repo rule: every
  dimension); imported comments are unverified authorship and must be marked as imported, not
  attributed to app users.

**Recommendation:** export is opt-in, writes legacy cell comments (widest support) with resolved
state as text or the `done` flag where the writer supports threads, maps authors through an app
callback, neutralizes formulas; import is out of scope for the first version.

---

## 11. Data protection and untrusted text

### Findings

- GDPR Art. 4(1): any information relating to an identifiable person is personal data — the
  author field, timestamps tied to the author, and free text that names people.
- Art. 5(1)(c) data minimisation and 5(1)(e) storage limitation; Art. 17 right to erasure;
  Art. 25 data protection by design and by default (EDPB Guidelines 4/2019: defaults should
  collect and keep the minimum). Art. 9: free text can contain special-category data the
  controller never asked for.
- OWASP XSS prevention: render untrusted text as text; sanitize only when markup is required.
- OWASP API Security (API4, unrestricted resource consumption): bound sizes and rates server-side.
- RFC 9562 §8: UUIDv7 ids leak creation time; not secret.

### Concerns and options for a client library

| Concern | Library's job | App's job |
| --- | --- | --- |
| XSS | Render bodies and names as React text; no markdown/HTML by default; links only through `safeHref` | Sanitize if it adds rich text |
| Spoofed author | Never trust `authorId` from `applyRemote` for permissions; display what the app gives | Set author server-side from the session (API3) |
| Bidi / control characters | Render names and bodies in `<bdi>` / `dir="auto"` so an override cannot reorder surrounding UI text | Strip or reject controls if needed |
| Size | `maxBodyLength` (default bounded), max comments per cell rendered, max cached threads | Server limits, rate limits |
| Erasure | Tombstones carry no body and no author; `applyRemote` removal clears drafts and caches | Delete or anonymize at source; propagate erasure as a delete |
| Retention | No persistence of its own (no `localStorage` of bodies by default) | Retention policy |
| Drafts | Unsent draft held in memory per cell; optional persistence is app opt-in | Decide whether drafts may be stored |
| Mentions | Out of scope; plain text | Notification and consent |
| Timestamps | Format with a pinned locale and time zone to avoid hydration mismatch (repo lesson) | Supply server time |

**Recommendation:** text-only rendering, bounded bodies and caches, content-free tombstones, no
storage of its own, author fields displayed but never trusted; document that authorship,
retention, erasure, and rate limits belong to the app.

---

## Recommendations for gridcn

1. (1) Anchor = `{ rowId, columnId }`. No view or data index. The grid never declares a comment
   orphaned; the app does, through the same remote channel. Filtered, hidden, and unloaded anchors
   keep their comments.
2. (1) Provide `remapRowId` (or accept an alias) for temp-to-server row id changes, since
   optimistic row creation already produces them.
3. (2) Flat list per cell; `resolved` per comment; the cell is "open" when any comment is open;
   resolve/reopen write every comment of the cell in one batch; a new comment reopens the cell.
4. (3) Client ids from `crypto.randomUUID()` with an app `createId` override; the id is the
   create's idempotency key; order by `(createdAt, id)`, server time replaces client time on
   confirmation.
5. (4) Per-record `version` with compare-and-swap semantics in the app's transport; the add-on
   tracks confirmed vs pending state, rolls back on rejection, keeps the draft on a stale edit;
   delete wins over edit; no CRDT dependency.
6. (5) State-based `applyRemote(records)`: drop `version <=` known, confirm echoes by `mutationId`,
   keep content-free tombstones with a bounded lifetime; `onLocalChange` fires after the
   outermost store write, isolated per callback.
7. (6) Two-level data: per-cell summaries (`count`, `openCount`) drive markers; thread bodies load
   through `loadThread`; expose rendered row ids for the app's range fetch; LRU cache that never
   evicts open, pending, or drafted threads; drop late responses.
8. (7) Sync per-action predicates with defaults (comment: not `readOnly`; edit: author; delete:
   author or moderator; resolve: anyone who can comment); `readOnly` gates every write path; no
   async gate in the first version.
9. (8) Cell stays the focus target; marker `aria-hidden`; cell text via shared `aria-describedby`;
   labelled non-modal `role="dialog"`; open with Shift+F2 and a context-menu item (no Ctrl+Alt,
   no Ctrl+Option, no Cmd+Option+M); focus returns by cell id after scroll-into-view, keyboard
   opens only; remote changes announced for the active cell through the existing live region;
   open vs resolved differ by shape, 3:1 contrast in all themes.
10. (9) Separate store slice keyed by row id → column id; row-level selector; data attribute +
    CSS corner, no per-cell component; comments never rebuild the view; skip rows without ids.
11. (10) Comment export opt-in; legacy cell comments first, threaded parts only after a verified
    round trip; authors through an app callback; formula neutralization; no import in v1.
12. (11) Text-only rendering with `<bdi>`, bounded body length and caches, no storage of bodies,
    pinned locale for timestamps; the docs state that author identity, permissions enforcement,
    retention, erasure, and rate limits are the app's job.

Open questions for the spec: one marker for "has comments in hidden columns" on the row header or
none; whether the popover closes when the active cell moves; whether resolved comments stay
listed (collapsed) or hide by default; a grid-wide comments panel (list of all threads, including
orphans) as part of this add-on or a separate one.

---

## Sources

High-trust standards and specifications:

- WAI-ARIA Authoring Practices, Grid pattern — https://www.w3.org/WAI/ARIA/apg/patterns/grid/
- WAI-ARIA Authoring Practices, Dialog (modal) pattern —
  https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- WAI-ARIA Authoring Practices, Disclosure pattern —
  https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- WAI-ARIA Authoring Practices, Developing a keyboard interface (shortcut conflicts) —
  https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- WAI-ARIA 1.2 (`aria-haspopup`, `aria-expanded` used on `gridcell`) —
  https://www.w3.org/TR/wai-aria-1.2/
- WAI-ARIA 1.3 draft (`comment` role, `aria-details`, `aria-description`) —
  https://w3c.github.io/aria/
- WCAG 2.2 (1.4.1, 1.4.11, 1.4.13, 2.1.1, 2.4.7, 2.4.11, 2.5.8, 4.1.3) — https://www.w3.org/TR/WCAG22/
- Understanding WCAG 2.5.8 Target Size (Minimum) —
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C Web Annotation Data Model — https://www.w3.org/TR/annotation-model/
- RFC 9110 HTTP Semantics, conditional requests (`If-Match`, 412) —
  https://www.rfc-editor.org/rfc/rfc9110.html#name-conditional-requests
- RFC 6585 (428 Precondition Required) — https://www.rfc-editor.org/rfc/rfc6585.html
- RFC 9562 UUIDs (UUIDv7) — https://www.rfc-editor.org/rfc/rfc9562.html
- IETF httpapi draft, The Idempotency-Key HTTP Header Field (draft 08, active Internet-Draft) —
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- RFC 7111 URI fragment identifiers for text/csv — https://www.rfc-editor.org/rfc/rfc7111.html
- RFC 4180 CSV — https://www.rfc-editor.org/rfc/rfc4180.html
- ECMA-376 Office Open XML (core spreadsheet comments) —
  https://ecma-international.org/publications-and-standards/standards/ecma-376/
- OASIS OpenDocument v1.3 (`office:annotation`) — https://docs.oasis-open.org/office/OpenDocument/v1.3/
- Shapiro, Preguiça, Baquero, Zawirski, A comprehensive study of convergent and commutative
  replicated data types, INRIA RR-7506 (2011) — https://inria.hal.science/inria-00555588
- Lamport, Time, Clocks, and the Ordering of Events in a Distributed System, CACM 21(7), 1978.
- OWASP Cross Site Scripting Prevention Cheat Sheet —
  https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP CSV Injection — https://owasp.org/www-community/attacks/CSV_Injection
- OWASP API Security Top 10 (2023) — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- Regulation (EU) 2016/679 (GDPR), Art. 4, 5, 9, 17, 25 — https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EDPB Guidelines 4/2019 on Article 25 Data Protection by Design and by Default —
  https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-42019-article-25-data-protection-design-and_en

Generic sources (read for behavior; not named):

- Spreadsheet vendor docs: comments API for add-ins (thread per cell, resolved, events, author
  attribution).
- Spreadsheet vendor open specification: threaded comments extension (`threadedComment`
  attributes, persons part).
- Document-collaboration API docs: managing comments and replies (opaque anchors, unanchored
  comments, resolve action, `deleted` flag, cursor paging, `startModifiedTime`).
- Developer reference docs for `aria-haspopup` and the `comment` role.
- Browser developer-tools keyboard shortcut reference (responsive design mode chords).
- Desktop screen reader user guide (VO modifier keys).
- Office-suite implementation notes on OpenDocument annotations in table cells.
