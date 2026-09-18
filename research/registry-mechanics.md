# shadcn Registry Mechanics — Replication Guide for gridcn

Based on `references/ui` (shadcn-ui/ui monorepo). Source of truth: the Zod schema at `packages/shadcn/src/registry/schema.ts`; consumer docs at `apps/v4/content/docs/registry/`.

## 1. registry-item.json schema

### Item types
`registry:lib` `registry:block` `registry:component` `registry:ui` `registry:hook` `registry:page` `registry:file` `registry:theme` `registry:style` `registry:item` `registry:base` `registry:font` (+ internal: `registry:example`, `registry:internal`).

### Common fields
```jsonc
{
  "$schema": "https://ui.shadcn.com/schema/registry-item.json",
  "name": "data-grid",              // required
  "type": "registry:block",         // required (discriminator)
  "title": "...", "description": "...", "author": "... (min 2 chars)",
  "dependencies": ["papaparse", "zod@^3.20"],       // npm packages, name@version ok
  "devDependencies": [],
  "registryDependencies": ["button", "@acme/x", "https://.../item.json"], // other registry items
  "files": [ ... ],
  "cssVars": { "theme": {...}, "light": {...}, "dark": {...} },
  "css": { "@layer base": { ... } },  // raw CSS (Tailwind v4); old `tailwind` field is v3-only
  "envVars": {}, "meta": {}, "docs": "post-install note", "categories": ["data"]
}
```

- `dependencies` = npm names. `registryDependencies` = registry item addresses: bare `button` (resolves against builtin @shadcn), namespaced `@acme/input`, GitHub `owner/repo/item`, or full URL.

### Files array
```jsonc
{ "path": "registry/default/blocks/data-grid/data-grid.tsx", "type": "registry:component" }
// registry:file / registry:page REQUIRE target:
{ "path": "blocks/x/page.tsx", "type": "registry:page", "target": "app/x/page.tsx" }
```
`content` is optional in source and **populated by the build**.

## 2. Build & serve

### Build (`npx shadcn build [registry.json] --output public/r`)
Implementation: `packages/shadcn/src/commands/build.ts` + `registry/loader.ts`. For each item: rewrites file paths relative to registry root, **reads each source file and inlines it into `file.content`**, stamps `$schema`, validates, writes `<name>.json` per item into the output dir, plus a `registry.json` catalog (content stripped).

### Source layout in shadcn's own repo (apps/v4)
- Registry source: `apps/v4/registry/new-york-v4/{ui,blocks,charts,lib,hooks,examples}/` with `_registry.ts` arrays assembled in `registry.ts`.
- Built payloads: `apps/v4/public/r/styles/<style>/<name>.json`.
- Imports inside registry source use the `@/registry/...` alias — **required**; rewritten to consumer aliases on install.

### Serving options
- Static: `public/r/*.json` on any host → `https://host/r/<name>.json`.
- Dynamic: `loadRegistry()` / `loadRegistryItem(name)` from `shadcn/registry` in a Next route (`app/r/[name].json/route.ts`).
- Content negotiation possible (JSON to the CLI via User-Agent/Accept, HTML to browsers).

## 3. Third-party registry / namespacing

Address forms for `npx shadcn add <target>`:
| Form | Example |
|---|---|
| Full URL | `npx shadcn add https://gridcn.dev/r/data-grid.json` |
| Local file | `./data-grid.json` |
| Namespaced | `@gridcn/data-grid` (expanded via components.json `registries`) |
| GitHub | `owner/repo/path/item` (optional `#ref`) |
| Bare | `button` → builtin `@shadcn` |

Namespace config (consumer `components.json`):
```jsonc
{ "registries": { "@gridcn": "https://gridcn.dev/r/{name}.json" } }
```
Set up via: `npx shadcn@latest registry add @gridcn=https://gridcn.dev/r/{name}.json`. Keys must start with `@`. Template expands `{name}`, `{style}`; supports `${ENV_VAR}`, query `params`, auth `headers`. Catalog served at `.../r/registry.json` (powers `list`/`search`/`view`).

### Top-level registry.json
```jsonc
{ "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "gridcn", "homepage": "https://gridcn.dev",
  "items": [ /* items with path+type files, no content */ ] }
```
`include` composition exists (nested registry.json files, source-side only, strict path rules).

## 4. Consumer components.json → file placement

- `registry:ui` → `aliases.ui`; `registry:component`/`registry:block` files → `aliases.components`; `registry:lib` → `aliases.lib`; `registry:hook` → `aliases.hooks`; `registry:file`/`registry:page` → explicit `target`.
- `@/registry/...` imports in content rewritten to consumer aliases on install.
- `tailwind.config === ""` signals Tailwind v4. `style` fills `{style}` in URL templates.

## 5. shadcn's own data-table story (positioning)

**There is NO installable data-table registry item.** The data-table docs are a guide ("build your own with TanStack + <Table>"). The only real multi-file data table ships buried inside the `dashboard-01` block (11 files, `@tanstack/react-table` + `@dnd-kit` deps, ~20 registryDependencies). → gridcn fills a deliberate gap; model the item on the **dashboard-01 block pattern**.

## 6. Replication checklist for gridcn

1. Root `registry.json` (name, homepage, items).
2. Author the grid as `registry:block`-style items: files with `path`+`type` (no content); npm deps in `dependencies`; shadcn primitives (`button`, `dropdown-menu`, `popover`, `dialog`, `input`, `select`, `checkbox`, ...) in `registryDependencies`; `@/registry/...` imports in source.
3. `npx shadcn build registry.json --output public/r` → per-item JSON + catalog.
4. Serve from the docs site (static `public/r/`).
5. Install: URL form or `registry add @gridcn=...` + `add @gridcn/data-grid`.
6. Split heavy deps: keep the core grid item dependency-free; ship xlsx/papaparse in a separate `data-grid-io` item.
7. **Test installs** into fresh Next and Vite apps, including non-default aliases (the known CLI friction point).

### Reference files (in references/ui)
- Schema: `packages/shadcn/src/registry/schema.ts`
- Build: `packages/shadcn/src/commands/build.ts`; loader: `src/registry/loader.ts`
- Namespace resolution: `src/registry/{address,parser,builder,resolver,constants,config}.ts`
- Block example: `apps/v4/registry/new-york-v4/blocks/_registry.ts` + `blocks/dashboard-01/`
- Built payload example: `apps/v4/public/r/styles/new-york-v4/dashboard-01.json`
- Docs to mirror: `apps/v4/content/docs/registry/{getting-started,registry-json,registry-item-json,namespace}.mdx`
