# Manual install docs (workplan #98)

Status: spec, not implemented.
User request: "in shadcn and diceui documentation you can install it manually — please add this too,
with reusable components, and it should be clean like their documentation, same pattern as they did it".

## 1. What shadcn and diceui actually do

Both use the identical shape. `references/ui/apps/v4/content/docs/components/base/accordion.mdx`:

```mdx
## Installation

<CodeTabs>

<TabsList>
  <TabsTrigger value="cli">Command</TabsTrigger>
  <TabsTrigger value="manual">Manual</TabsTrigger>
</TabsList>

<TabsContent value="cli">

```bash
npx shadcn@latest add accordion
```

</TabsContent>

<TabsContent value="manual">

<Steps className="mb-0 pt-2">

<Step>Install the following dependencies:</Step>

```bash
npm install @base-ui/react
```

<Step>Copy and paste the following code into your project.</Step>

<ComponentSource name="accordion" title="components/ui/accordion.tsx" />

<Step>Update the import paths to match your project setup.</Step>

</Steps>

</TabsContent>

</CodeTabs>
```

diceui (`references/diceui/docs/content/docs/components/base/file-upload.mdx`) is the same file,
with `<ComponentTabs>` for the preview and `package-install` fences instead of `bash`. Its only
addition is the multi-file case: it repeats `<ComponentSource>` once per file, each with its own
prose `<Step>` naming the destination directory.

```mdx
<Step>Copy and paste the direction utilities into your `components/direction.tsx` file.</Step>
<ComponentSource name="direction" />

<Step>Copy and paste the following hooks into your `hooks` directory.</Step>
<ComponentSource name="use-as-ref" />
<ComponentSource name="use-lazy-ref" />

<Step>Copy and paste the following code into your project.</Step>
<ComponentSource name="file-upload" />
```

Load-bearing facts from reading both implementations
(`references/ui/apps/v4/components/component-source.tsx`,
`references/diceui/docs/components/component-source.tsx`):

- `ComponentSource` renders **exactly one file**: `code = item?.files?.[0]?.content`. It is not a
  multi-file renderer. diceui's file-upload works only because each of its "files" is a separate
  registry item.
- Collapsible is **on by default** (`collapsible = true`), implemented by
  `CodeCollapsibleWrapper`: `max-h-64` when closed plus a gradient fade over an Expand trigger.
  A 350-line file is never a wall of code on first paint.
- The title of the block is the destination path, not the component name. diceui derives it from
  `item.files[0].path` when not given explicitly; shadcn passes
  `title="components/ui/accordion.tsx"` by hand.
- Neither renders `registryDependencies` in the Manual tab at all. shadcn's accordion has none;
  where they exist (e.g. a component depending on `button`), the manual instructions silently
  assume you already ran the CLI for those. **We cannot copy this omission** — see §3.

## 2. What this repo already has

| Thing | Location | State |
|---|---|---|
| `<InstallCommand item>` | `components/install-command.tsx` | Done. Base UI `Tabs.Root`, 4 package managers, `localStorage` + module-scope pub/sub sync, copy button. Emits `<runner> shadcn@latest add @gridcn/<item>`. |
| `<ComponentPreview name>` | `components/component-preview.tsx` | Done. Server component; highlights with `fumadocs-core/highlight`, renders through `PreviewTabs`. |
| `<PreviewTabs>` | `components/preview-tabs.tsx` | Done. The house tab shell: pill tabs in a `bg-secondary/50` header bar, `rounded-xl border border-border`. **The Manual/CLI tab shell must match this exactly.** |
| `Steps` / `Step` | `components/mdx.tsx` line 2, 16-17 | Already imported from `fumadocs-ui/components/steps` and already in the MDX component map. |
| `Tabs` / `Tab` | `fumadocs-ui/dist/components/tabs.js` | Present in node_modules, **not** wired into `components/mdx.tsx`. |
| `Files` / `File` / `Folder` | `fumadocs-ui/dist/components/files.js` | Present, not wired. Useful for the core-item file tree. |
| Registry payloads | `public/r/<item>.json` | Every file carries `path`, `target`, `content`, `type`. This is a complete manual-install data source at build time. |
| Collapsible primitive | — | **Absent.** `components/ui/` has no `collapsible.tsx`. Needs adding or substituting (see §5, Lane B). |
| `docs` field on registry items | `registry.json` | Absent. Item keys are name/type/title/description/author/dependencies/registryDependencies/files/categories. |

Existing usage: `<InstallCommand>` appears on 10 docs pages (`columns`, `fill-handle`,
`import-export`, `lazy-loading`, `multiplayer-presence`, `pagination`, `pinned-rows`,
`sorting-filtering-search`, `undo-redo`, `url-state`). `installation.mdx` uses `<Steps>` directly
and hardcodes its CLI commands in `bash` fences rather than using `<InstallCommand>`.

## 3. The hard constraint: item sizes

Measured from `public/r/*.json` (content lines, excluding demos):

| Item | Files | Lines | KB | npm deps | registryDependencies |
|---|---:|---:|---:|---|---|
| `data-grid` | **89** | **13303** | 606 | zustand | button input select checkbox popover calendar dropdown-menu context-menu separator tooltip |
| `data-grid-fill` | 11 | 984 | 45 | zustand | @gridcn/data-grid |
| `data-grid-context-menu` | 10 | 523 | 24 | — | @gridcn/data-grid context-menu dropdown-menu tooltip |
| `data-grid-io` | 10 | 907 | 42 | xlsx papaparse | @gridcn/data-grid dialog select dropdown-menu button |
| `data-grid-url-state` | 9 | 474 | 19 | nuqs | @gridcn/data-grid |
| `data-grid-keybindings` | 7 | 305 | 13 | — | @gridcn/data-grid dialog |
| `data-grid-toolbar` | 7 | 913 | 37 | @dnd-kit/react | @gridcn/data-grid dropdown-menu popover input button badge select |
| `data-grid-pinned-rows` | 5 | 329 | 15 | zustand | @gridcn/data-grid |
| `data-grid-lazy` | 4 | 336 | 15 | — | @gridcn/data-grid |
| `data-grid-pagination` | 4 | 378 | 15 | — | @gridcn/data-grid button select |
| `data-grid-presence` | 4 | 324 | 15 | zustand | @gridcn/data-grid |
| `data-grid-history` | 3 | 175 | 7 | — | @gridcn/data-grid |
| `data-grid-sort-list` | 2 | 311 | 13 | @dnd-kit/react | @gridcn/data-grid popover button badge select |

Two populations, not one:

- **The core.** 89 files, 13303 lines, 606 KB of content. Copy-paste is not a real procedure. Even
  collapsed, 89 code blocks would ship ~600 KB of highlighted HTML into one page. This item does
  not get a copy-paste Manual tab.
- **Every add-on.** 2-11 files, 175-984 lines. This is diceui's file-upload scale. Copy-paste is a
  genuine procedure here, and collapsed blocks keep the page short.

Second constraint shadcn does not have: **every add-on's `registryDependencies` includes
`@gridcn/data-grid`**, plus shadcn/ui primitives. A manual install of `data-grid-fill` that omits
this is a broken procedure — the copied files import from `@/components/data-grid/*` that does not
exist. The Manual tab must state prerequisites; it cannot inherit shadcn's silence.

## 4. The decision

**Manual = "copy these files" for add-ons. Manual = "clone the folder" for the core.**

Concretely:

- **Add-ons (12 items): a real Manual tab.** Generated from `public/r/<item>.json` at build time.
  Dependencies, prerequisite registry items, then one collapsed code block per file titled with its
  `target` path.
- **`data-grid` (core): no copy-paste tab.** `installation.mdx` gets a `## Manual installation`
  section that is a procedure, not a code dump: list the npm dep, list the 10 shadcn primitives to
  `npx shadcn add`, then point at the source folder to copy wholesale, with a `<Files>` tree of the
  top-level directories so the reader knows the shape. No 89 code blocks.
- **Source of truth is the payload, never hand-copied MDX.** Files, targets, and deps change with
  every registry build; a curated MDX block would silently rot. `public/r/*.json` is committed and
  already the exact bytes a consumer receives.

Rejected alternatives, with reasons:

- *Curated per-item MDX listing each file* — 12 pages × up to 11 blocks hand-maintained against a
  registry that regenerates. Rots on the first refactor.
- *A `docs` string field on registry.json items* — adds a hand-written surface to the registry for
  something already derivable; also changes `registry.json`, out of scope here.
- *Public-files-only subset (barrel + entry points)* — tempting for the core, but the barrel
  re-exports 89 files; a partial copy does not compile. Rejected as a half-truth.
- *Rendering the core's 89 files collapsed* — ~600 KB of highlighted HTML on one route. Rejected on
  page weight alone, before the usability argument.

## 5. The reusable component

```tsx
<ManualInstall item="data-grid-fill" />
```

One MDX component, one prop. Placed directly under the existing `<InstallCommand>` on each add-on
page — or, preferably, absorbed by it (see §6).

**Data source.** Server component. Reads `public/r/<item>.json` from disk at build time via a new
`lib/read-registry-item.ts` (mirrors the existing `lib/read-example-source.ts`, which reads
`registry/default/examples/<name>.tsx` with `fs.readFileSync` + `process.cwd()`). No fetch, no
runtime IO. Highlighting uses `fumadocs-core/highlight`, the same call `component-preview.tsx`
makes.

**What it renders** — a `<Steps>` sequence, in this order, each step omitted entirely when empty:

1. *Prerequisites* — only when `registryDependencies` is non-empty. Split into gridcn items
   (`@gridcn/*`) and shadcn primitives, each as an `<InstallCommand>`-styled command. For
   `data-grid-fill` this is `npx shadcn add @gridcn/data-grid`.
2. *Install dependencies* — only when `dependencies` is non-empty. A package-manager-tabbed
   `npm install`-style block. **Reuse the manager state from `install-command.tsx`** — the
   module-scope `listeners` set and `STORAGE_KEY` are already there; extract them into
   `lib/package-manager.ts` so both components share one persisted choice rather than desyncing.
3. *Copy the files* — one collapsed block per entry in `files`, titled with `file.target`
   (`components/data-grid-fill/use-fill-handle.ts`), language from the extension. Ordered barrel
   first, then alphabetically, so the entry point is what the reader sees at the top.
4. *Update import paths* — one line, matching shadcn's wording.

**Collapsed by default.** Non-negotiable given file sizes (`use-fill-handle.ts` is 352 lines). Copy
shadcn's `CodeCollapsibleWrapper` behavior: `max-h-64` closed, gradient fade to an Expand trigger,
copy button always reachable. `components/ui/collapsible.tsx` does not exist in this repo — either
add it via `npx shadcn add collapsible`, or implement the wrapper with a plain `useState` and a
`data-state` attribute, which is what its 40 lines amount to. Prefer the plain version; no new
dependency for one disclosure widget.

**The tab shell.** Do **not** introduce fumadocs `<Tabs>` for this. `components/preview-tabs.tsx`
already defines the house tab look (Base UI `Tabs.Root`, `rounded-xl border border-border`,
`bg-secondary/50` header, `data-active:` pill states), and `install-command.tsx` repeats it. A third
tab styling would be visibly off. Extract the shared shell into `components/docs-tabs.tsx` and have
all three use it.

## 6. Page-level shape

The cleanest result is **not** a second component sitting next to `<InstallCommand>`. It is
`<InstallCommand>` gaining the Manual tab, because that component already owns the CLI half and
already renders a tab bar. shadcn's `CodeTabs` is exactly this: CLI and Manual as two tabs of one
widget.

Before — `content/docs/fill-handle.mdx`:

```mdx
<ComponentPreview name="data-grid-demo" align="center" />

<InstallCommand item="data-grid-fill" />
```

After:

```mdx
<ComponentPreview name="data-grid-demo" align="center" />

<InstallCommand item="data-grid-fill" manual />
```

`<InstallCommand>` renders a `Command | Manual` tab pair when `manual` is set, and its current bare
package-manager block when not. The Manual panel is `<ManualInstall item={item} />`. Pages that
should stay CLI-only (`columns.mdx`, `sorting-filtering-search.mdx` — these reference the core, not
an add-on) simply do not pass the flag.

Composition note: `InstallCommand` is `"use client"`; `ManualInstall` is a server component reading
the filesystem. Pass it as a `children`/slot prop from the MDX layer so the server-rendered subtree
is handed to the client shell — the same split `component-preview.tsx` (server) /`preview-tabs.tsx`
(client) already uses.

**Rollout order:**

1. `fill-handle.mdx` — 11 files, the largest add-on, worst case for page weight. Validate here first.
2. `undo-redo.mdx` — 3 files, the smallest. Validates that empty steps (no npm deps) collapse cleanly.
3. Remaining add-on pages: `import-export`, `lazy-loading`, `multiplayer-presence`, `pagination`,
   `pinned-rows`, `url-state`.
4. Add-ons with no current `<InstallCommand>` page section (`data-grid-toolbar`,
   `data-grid-sort-list`, `data-grid-context-menu`, `data-grid-keybindings`) — check whether their
   docs pages exist and want one.
5. `installation.mdx` — the core's `## Manual installation` prose section. Last, and different in
   kind from the rest.

## 7. Docs prose rules

The pages this produces must follow the repo's rules (`docs-prose-minimal`, `jsdoc-no-restating`):

- Example first. The tab widget is the example; no paragraph introduces it.
- Bare facts. "Install the following dependencies:" not "You will first want to make sure that...".
- No comparative framing. Never "unlike other grid libraries" or "as with shadcn".
- No meta-narration. No "Here we show you how to...".
- Step text is one line. Everything else is generated.
- Reuse shadcn's exact step wording where it fits — it is already minimal and readers recognize it.

The core's manual section in `installation.mdx` is the only place with more than one line of prose,
and it should stay under ~8 lines plus the file tree.

## 8. Effort

| Piece | Size | Notes |
|---|---|---|
| `lib/read-registry-item.ts` + types | S | ~30 lines, mirrors `read-example-source.ts`. |
| `lib/package-manager.ts` extraction | S | Move `STORAGE_KEY`/`listeners`/`usePackageManager` out of `install-command.tsx`. Pure refactor, no behavior change. |
| `components/docs-tabs.tsx` shared shell | M | Extract from `preview-tabs.tsx`; migrate `preview-tabs` and `install-command` onto it without visual drift. Highest regression risk in the whole workplan. |
| `components/code-collapsible.tsx` | M | Expand/collapse + gradient + copy. No `collapsible` primitive in repo; hand-roll. |
| `components/manual-install.tsx` | M | Server component, step assembly, per-file highlight loop. |
| `<InstallCommand manual>` + slot wiring | S | Tab pair plus children slot. |
| MDX page edits (8-12 pages) | S | One prop per page. |
| `installation.mdx` core manual section | S | Prose + `<Files>` tree. Wire `Files`/`File`/`Folder` into `components/mdx.tsx`. |
| Docs build + page-weight check | S | Confirm `fill-handle` route size stays sane with 11 highlighted blocks. |

Total: M. No L pieces once the core is excluded from copy-paste — that exclusion is what keeps this
workplan small.

## 9. Lane split

Three lanes, disjoint files, joined at the end.

**Lane A — primitives** (`lib/read-registry-item.ts`, `lib/package-manager.ts`,
`components/code-collapsible.tsx`).
No existing file changed except `install-command.tsx`'s import of the extracted PM hook. Ships
independently, testable in isolation. Start here; B depends on it.

**Lane B — the tab shell** (`components/docs-tabs.tsx`, edits to `components/preview-tabs.tsx` and
`components/install-command.tsx`).
Pure visual refactor plus the `manual` prop and children slot. Must land with a before/after
screenshot of an existing page — this lane touches every page that already renders a tab widget.
Depends on Lane A only for the PM hook import.

**Lane C — the component and the pages** (`components/manual-install.tsx`, `components/mdx.tsx`,
`content/docs/*.mdx`).
Consumes A and B. Can start against a stub shell and be rebased once B lands. The MDX edits are
mechanical once the component exists.

`components/mdx.tsx` is touched only by Lane C (registering `ManualInstall`, `Files`, `File`,
`Folder`). `install-command.tsx` is touched by A (import) and B (props) — sequence B after A rather
than parallelizing them on that file.

## 10. Non-goals

- No Manual copy-paste tab for `data-grid`. Explicitly out of scope, permanently, not "later".
- No changes to `registry.json` or the registry build. The payloads are already sufficient.
- No new `docs` metadata field on registry items.
- No per-file registry items (diceui's approach of promoting each file to its own item) — that would
  triple the registry surface to serve documentation.
- No copy-all-files button, no zip download, no "download as tarball".
- No changes to `<ComponentPreview>` behavior beyond adopting the shared tab shell.
- No CLI changes, no `shadcn` flag work.
- No RTL, no i18n of step text.
