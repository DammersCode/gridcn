# Plan 014 — Docs-Nav-Regrouping, Demo-Install-Validation, @shadcn/lint, Hero Mobile

Branch: `docs/improvements` (Worktree `C:\Users\dahe\AppData\Local\Temp\opencode\gridcn-docs-improvements`).
Voraussetzung: Plan 013 vollständig grün (Stand: `689a49b`; Gates types:check/build/test/lint/registry:verify alle exit 0).
Alle vier Tasks laufen parallel, touchen disjunkte Dateibereiche, und werden je mit eigenem Commit abgeschlossen.
Nichts pushen — lokal bis Nutzeranfrage.

## Gemeinsame Regeln

- Commit-Style wie im Repo (`docs:`, `fix(home):`, `chore(lint):`, `test:`), KEIN `Co-Authored-By`-Trailer.
- Gates pro Task unten; am Ende jedes Task-Blocks: `pnpm build` grün (MDX-Falle: offene Component-Tags findet nur der Build).
- PowerShell: git-grep-Patterns in Single-Quotes; `git grep`-Output hat keine `.Line`-Property.
- Browser-Tests: vitest `browser`-Projekt, include-Pattern `registry/**/*.browser.test.{ts,tsx}` — neue Browser-Tests also UNTER `registry/` legen (oder Include-Muster bewusst erweitern).
- node_modules-Korruption in diesem Worktree beobachtet (fehlende Chunk-Files): Symptom `Cannot find module './<name>.js'` aus `.pnpm/<pkg>` → Fix: `Remove-Item -Recurse -Force node_modules\.pnpm\<dir>` + `pnpm install`.

## Task 1 — Docs-Nav-Regrouping + Content-Moves

Scope (Nutzerentscheidung): **Gruppierung + Content-Moves** (kein Voll-Re-Audit aller Seiten).

1. `content/docs/meta.json`: Features-Flachliste in Subgruppen (fumadocs `---[Icon]Title---`-Sektionen,
   Icons aus lucide, Bestand prüfen). Zielstruktur (Agent kann innerhalb der Prinzipien variieren):
   - **Editing**: editing-cell-types, custom-cell-types, clipboard
   - **Selection & navigation**: selection-keyboard, sorting-filtering-search
   - **Rows & data**: row-operations, streaming-updates, lazy-loading, lazy-loading-advanced, pagination
   - **Columns & layout**: columns, styling-theming, i18n
   - **Architecture**: overlay-plugins, performance, virtualization, accessibility
   Prinzip: Gruppe nach Nutzerabsicht; Reihenfolge in Gruppen nach Lernpfad (einfach → fortgeschritten).
   Slugs/URLs bleiben UNBERÜHRT (nur Nav-Reihenfolge/Gruppen) — außer Task 2-Moves.
2. **Row-markers-Move**: H2 `Row markers` + H3 `Custom markers` aus `content/docs/columns.mdx` nach
   `content/docs/row-operations.mdx` verschieben (passende Stelle: nach den Row-Op-Sektionen, vor dem
   Pinned-rows-Cross-Link). Beispiele-Seite `content/docs/examples/columns/row-markers.mdx` →
   `content/docs/examples/rows/row-markers.mdx` (Dateimove + Nav-Gruppen in
   `content/docs/examples/columns/meta.json` bzw. `rows/meta.json` anpassen).
   INBOUND-URLs `docs/examples/columns/row-markers` und Anker `columns#row-markers` /
   `columns#custom-markers` über `git grep` finden und umziehen (content + registry + app).
   Die Demo `data-grid-row-markers-demo` bleibt im Registry.
3. Cross-Link-Check danach: `git grep -rn "docs/columns#\|docs/row-operations#\|examples/columns/row-markers" content app registry`
   → jeder Link muss auf eine existierende Heading/URL zeigen (fumadocs-Slugs: `&` → `--`, Em-Dash → `--`,
   Backticks/Punkte weggelassen, `&`-Slug-Beispiel: `keyboard--accessibility`).
4. Gates: `pnpm types:check`, `pnpm build`, Link-Check wie (3). Manuell: Nav in `pnpm dev` zeigt die
   Gruppen in der Sidebar; `/docs/columns` und `/docs/row-operations` rendern; `/docs/examples/rows/row-markers` existiert.
5. Commit: `docs: regroup the feature nav and move row markers to the row pages`

## Task 2 — Demo-Install-Validation (Fleet)

Ziel: Beweis, dass jeder Registry-Demo (aktuell ~20 Items in `registry/default/examples/*.tsx` +
`registry.json`) **nach Install sofort funktioniert, ohne Extra-Konfiguration**.

1. **Statischer Install-Check (Skript, 1× für alle)**: NEU `scripts/verify-demo-install.mjs`:
   für jedes `registry:example`-Item in `registry.json`: (a) `registryDependencies` +
   `dependencies`-Referenzen existieren als Items in `registry.json`; (b) alle `files[].content`-Imports
   (aus `@/registry/...`, `@/components/ui/...`, `@/lib/...` und npm-Paketen) lösen sich auf:
   Payload-Dateien desselben + abhängiger Items, `components/ui/**` aus dem Repo, `components.json`-Aliases,
   oder ein in `package.json` (deps/devDeps) deklariertes npm-Paket. Unauflösbar = FAIL mit Item+Import-Name.
   `package.json`: Script `"demo:verify": "node scripts/verify-demo-install.mjs"`.
   Ausführen; alle FAILs beheben (Missing-Deps in `package.json` der Demos registrieren = in
   `registry.json` `dependencies` aufnehmen + `pnpm registry:build`).
2. **Runtime-Smoke (Browser-Test, 1× für alle)**: NEU
   `registry/default/examples/demo-smoke.browser.test.tsx` (Pattern: `demo-fit.browser.test.tsx`):
   mountet JEDES Demo und asserts: `[role="grid"]` existiert, > 0 Datenzeilen, und wo das Demo einen
   dokumentierten Kernzugriff hat (Button oben im Demo, z.B. Undo/Move-down/Filter-Add), ein generischer
   Klick-Smoke (Element sichtbar und enabled). Kein Demo-spezifisches Deep-Testing — das gehört in die
   bestehenden, demo-eigenen Tests. Neue FAILs beheben im Demo (nicht im Test abschwächen).
3. **API-Cross-Check (Fleet, read-only)**: pro Demo mit Third-Party-API ein Agent:
   - validation: zod/joi/valibot + Standard Schema (Standard-Schema-Spec)
   - lazy/server-side: @tanstack/react-query (useQuery/useMutation/onMutate/onError), nuqs
   - recipes-Beispiele in Docs: RHF (useForm/register/handleSubmit) — nur Code-Check (keins ist Demo-Item)
   - fill/pinned/presence/toolbar/sort-list/url-state/keybindings/io: nur gridcn-eigene API (gegen
     `content/docs/api-reference.mdx` + Quell-JSDoc prüfen, keine externeren Docs)
   Prüfen: API existiert in der installierten Version (`node_modules/<pkg>/package.json`),
   Signatur/Nutzung im Demo-Code korrekt, keine veralteten/entfernten Optionen, Demo-Deps in
   `package.json` mit kompatibler Version. Ergebnis: je Item 1 Block in
   `research/demo-validation-report.md` (Item, Bibliothek+Version, geprüfte APIs, Status OK/FIXED,
   was geändert wurde). Fixes direkt im Demo-Code + `pnpm registry:build` + Payload-Commits wie in Task-Windows zuvor.
4. **E2E-Install-Spotcheck (1×)**: `data-grid`-Item (oder `data-grid-fill`) in ein frisches,
   minimales Next.js+shadcn-Projekt installieren und Build + Smoke:
   - Lokales Registry-Hosting: `npx serve` (oder Node-Inline-Server) auf Worktree-Root
     (registry.json + public/r/), `components.json` im Testprojekt: `"registry": "http://localhost:<port>/registry.json"`
     (falls die shadcn-CLI das nicht akzeptiert: Fallback = Payload-Dateien 1:1 wie im Payload-JSON kopieren —
     gleicher Beweiswert für „keine Extra-Konfiguration“).
   - `npx shadcn@latest add data-grid --cwd <testprojekt>`, `pnpm build`, Screenshot + Grid-Render-Check
     (node/playwright oder agent-browser). Testprojekt nach `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\`.
   - Bericht + Befehlsprotokoll: `research/demo-e2e-install-report.md`.
   - Wenn die CI-Gate `shadcn registry validate` (ci.yml) auf den Branch-Zustand zeigt: nur lokal prüfen,
     keine CI-Änderung.
5. Gates: `pnpm demo:verify`, `pnpm test` (unit+browser), `pnpm registry:build && pnpm registry:verify`,
   `pnpm build`.
6. Commits (max 2): `test: add demo install and runtime smoke verification` +
   `fix(registry): <gelistete Demo-Fixes>` (falls Fixes nötig).

## Task 3 — @shadcn/lint in das Oxlint-Gate

Fakten: Oxlint 1.83.0 (≥1.80 ✓), Config `.oxlintrc.json`, `pnpm lint` = `oxlint . && verify-import-boundaries`,
CI-Step „Lint“ ruft `pnpm lint` auf → **keine CI-Änderung nötig**.

1. `pnpm add -D @shadcn/lint`.
2. `.oxlintrc.json`:
   - `"jsPlugins": ["@shadcn/lint"]`
   - settings.shadcn: `ui` auf den shadcn-Alias (`components.json` → `aliases.components`,
     i.d.R. `@/components/ui`), `componentImports` für `^@/registry(/|$)` (Registry-Komponenten sind
     eigene, className-forwarding Designs), `mergeFunctions` bleibt Default (cn/cx/clsx/cva/tv/...).
   - Regeln: `shadcn/no-unknown-classes: error`, `shadcn/no-raw-colors: error`,
     `shadcn/no-restyle: ["error", { allow: ["layout"] }]`.
   - **Gridcn-Komponenten sind bewusst className-override-fähig** (DataGrid & DataGridRoot forwarden
     `className` per `cn()`, Demos nutzen `rounded-none border-none`): per `overrides` (files
     `registry/default/blocks/**` + `app/**`) `no-restyle: off` ODER Contracts
     `{ pattern: "^(DataGrid|DataGridRoot)$", allow: ["all"] }` — Agent wählt, was mit dem wenigsten
     Rauschen grün wird, und dokumentiert die Wahl in einem Kommentar im Config.
   - `components/ui/**` bleibt unter no-restyle (layout-only): Button/Card/Dialog & Co. behalten
     ihr eigenes Padding/Shape.
3. `pnpm lint` laufen lassen: Violations FIXEN (Theme-Tokens statt raw colors, existierende Sizes statt
   Restyling). Wenn eine Rule systematisch falsche Positivs liefert (z.B. `no-unknown-classes` kennt
   Tailwind-v4-Generics nicht): Rule auf `warn` drosseln + Grund in Config-Kommentar, NICHT still
   ausknipsen.
4. Gates: `pnpm lint` exit 0, `pnpm build` exit 0, `pnpm lint:typed` exit 0 (ESLint-Config bleibt unberührt).
5. Commit: `chore(lint): add @shadcn/lint design-system rules to the oxlint gate`

## Task 4 — Hero-Page Mobile (Viewport 375×667)

Scope (Nutzerentscheidung): komplette Root-Page `/` bei **375×667** (Nutzer: „375x667“).
Dokumentations-Seiten sind ausdrücklich NICHT im Scope.

1. Fix `app/(home)/page.tsx:191`: Tagline-Card
   `mx-6 ... max-w-2xl ... px-10` → `w-full max-w-2xl px-6 sm:px-10` (mx-6 wegfallen; sonst
   width 100% + Marginen → Overflow). Gleiche Prüfung für alle Sections unter dem Hero auf der
   Seite (Vergleichstabelle ~L228 ff. u.a.): jedes Element muss bei 375px ohne
   Dokument-Overflow bleiben (breite Tabellen dürfen horizontal SCROLLBAREN Bereich bekommen:
   `overflow-x-auto` auf dem Container, nicht auf document).
2. NEU `registry/default/examples/home-mobile.browser.test.tsx` (Browser-Projekt-Include):
   - Viewport exakt `375x667` (Playwright-Device „iPhone 8“ oder manuell), `page.goto("/")`
     (echte Route inkl. Layout) — Pattern aus bestehenden Browser-Tests übernehmen (z.B.
     `tests/compiler-wiring.test.tsx` bzw. `registry/**/…browser.test.tsx` für `page`-Zugriff).
   - Asserts: `document.documentElement.scrollWidth <= 375`; Hero-Card
     (`max-w-2xl`-Box mit H1 „gridcn“) sichtbar (offsetParent != null) und ihre Breite <= 375;
     Screenshot-Anhang. Falls das Layout-Header-Navigation selbst überläuft: ebenfalls fixen.
   - Falls `page.goto` im Harness nicht verfügbar ist (nur Component-Rendering): Fallback =
     `render(<HomePage/>)` + Layout-Header-Component, gleiche Asserts auf document.
3. Gates: `pnpm vitest run --project browser registry/default/examples/home-mobile.browser.test.tsx`
   grün, `pnpm test` (unit+browser) grün, `pnpm build` grün.
4. Commit: `fix(home): fit the landing page to a 375px viewport and add the mobile test`

## Reihenfolge & Parallelisierung

- Task 1, 3, 4 sind unabhängig → parallel (je 1 Agent).
- Task 2: Teil 1+2 (Skript+Smoke-Test) erst SEQUENTIELL vor der Fleet, weil alle Fleet-Agenten
  dasselbe Repo sehen sollen; Teil 3 (API-Cross-Check) dann als Fleet (1 Agent pro Demo-Cluster,
  read-only + Fixes in disjunkten Demo-Dateien); Teil 4 (e2e) parallel zu 3.
- Konflikt-Regel: nur EIN Agent auf `package.json` (Task 3). Task 2-Fleet-Agenten dürfen
  `package.json` nur über Task-2-Lead ändern (Dependencies-Hinweise sammeln, nicht direkt editieren).
- Nach ALLEN Tasks: finale Gates `pnpm types:check && pnpm build && pnpm test && pnpm lint && pnpm registry:verify`
  einmal grün, dann `git log` gegen dieses Plan-File abgleichen (4-6 Commits erwartet).
