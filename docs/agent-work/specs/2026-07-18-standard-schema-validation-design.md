# Standard Schema validation for `validate` (workplan #53)

User directive: wherever we validate, accept Standard Schema so ANY library works (Zod, Valibot,
ArkType, ...). Today the only validation surface is `ColumnDef.validate` — a sync
method-shorthand `(value, row) => string | null`. No validation library exists in the repo and
none may ever be imported.

## API

- `validate` becomes a union: the existing function form (unchanged, bivariance trick kept) OR
  a Standard Schema `S extends StandardSchemaV1` for the column's value.
- Detection at the call site: `typeof validate === "object" && "~standard" in validate`.
- Execution per the spec: `schema["~standard"].validate(value)` — result may be sync or a
  Promise (await it). Failure = `result.issues` set (never throws); success = use
  `result.value` (schemas may transform — the COMMITTED value is `result.value`, documented).
- Error message: first issue's `message`; if multiple, join with "; ". `issue.path` segments are
  `PropertyKey | { key } | undefined` — cell values are scalars, so path is appended only when
  present (`path.map(seg => typeof seg === "object" ? seg.key : seg).join(".")` prefix).
- Types: `StandardSchemaV1.InferInput<S>` must accept the column's `TValue`;
  `InferOutput<S>` is the committed value type. Type-test both, incl. a @ts-expect-error for a
  schema whose input type mismatches the column value.

## Async path (the real design work)

The commit pipeline is synchronous today (commitCellEdit → validate → editingError). Async
branch lives at the editor-commit layer (interaction), NOT inside a store action:

- Function form and sync schema results: exactly today's behavior, zero changes.
- Promise result: editing STAYS OPEN with a pending flag (editor input disabled or visually
  pending — builder picks the minimal treatment, reduced-motion safe); on resolve with issues →
  `editingError` shows the message, editing continues; on success → commit `result.value` and
  apply the stored `{dx,dy}` movement then.
- Race guard: a generation counter — cancel/Escape, a newer commit, or unmount invalidates the
  pending validation (its resolution is dropped silently). The existing commit guard prevents
  double-commits as today.
- Paste/fill/import continue to use `fromText` + validate: where they call validate today they
  treat a Promise as ASYNC-UNSUPPORTED for bulk paths in v1 — bulk operations skip async
  schemas with a dev-mode warn (one line, documented) rather than serializing thousands of
  awaits; single-cell edit is the async surface. (Honest scope cut; revisit on demand.)

## Dependency handling

- Shipped code: VENDOR the `StandardSchemaV1` type into `types.ts` (≈90 lines incl. JSDoc) —
  no import from any package, nothing added to registry.json dependencies, consumers get zero
  new deps. Precedent: TanStack Form vendors the identical type for the same reason
  (references/form → packages/form-core/src/standardSchemaValidator.ts:117-214). The spec is
  frozen at version 1, so drift risk is ~nil.
- Repo only: `pnpm add -D @standard-schema/spec` + one type-level conformance test asserting
  our vendored type is assignable to/from the official one in both directions (drift fails tsc).
- No runtime import anywhere — `"~standard"` access is structural.

## Cross-check: TanStack Form (2026-07-31)

User-requested comparison; repo cloned at references/form. Their field validators are the same
union (`FieldValidateFn | StandardSchemaV1<TData, unknown>`, FieldApi.ts:160-177) with the same
structural detection (`'~standard' in v`). Divergence kept deliberately: they THROW when a sync
validator slot gets a Promise (they have separate sync/async slots); we have one `validate`
prop, so we await at the editor-commit layer per the async section above. Their array-index
path formatting is not ported (cell values are scalars). Docs mention the convention matches
TanStack Form's validators so it reads familiar.

## Docs

editing-cell-types.mdx's validate section: the two forms side by side (fn / any Standard Schema
library) with a Zod-flavored snippet written schema-agnostically (no zod import in repo code —
the snippet is illustrative for consumers); async behavior + transform note; bulk-path
limitation callout. custom-cell-types guide checklist gains one line. api-reference type note.

## Tests

Unit: sync schema pass/fail (mock StandardSchemaV1 object, no library), async pass/fail,
transform committed (`result.value !== input`), race (stale resolution dropped), path-prefix
formatting, fn form untouched (existing tests are the proof). Browser: async schema column —
commit shows pending then error; fix value then commit succeeds. Type tests per above.
