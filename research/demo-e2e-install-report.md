# E2E-Install-Spotcheck: `data-grid` in frischem Next.js+shadcn-Projekt

Datum: 2026-09-23 · Plan 014, Task 2, Teil 4 · Worktree `gridcn-docs-improvements` (Branch `docs/improvements`, Stand `689a49b`)

**Befund: PASS.** `data-grid` wird per echtem `shadcn add` aus lokalem Registry-Hosting in ein frisches,
minimales Next.js-16 + Tailwind-v4 + shadcn-Projekt installiert, baut ohne jede manuelle Änderung
(Exit 0) und rendert ohne Extra-Konfiguration auf `/` (`role=grid`, 3 Datenzeilen sichtbar).

## Ablauf

1. Testprojekt manuell minimal angelegt (create-next-app übersprungen — Flags reichen nicht gegen
   alle Prompts der aktuellen Version): `package.json` mit next 16.3.5 / react 19.3.0 / react-dom 19.3.0
   + Tailwind v4 (4.3.3, `@tailwindcss/postcss`), `tsconfig.json` mit Alias `@/*`, `postcss.config.mjs`,
   `next.config.ts`, `app/layout.tsx`, `app/globals.css` (`@import "tailwindcss"`), Platzhalter-`app/page.tsx`.
2. `pnpm install`.
3. `npx shadcn@latest init -y -b base --preset nova` (CLI 4.21.0). Schrieb `components.json`
   (Style `base-nova`, Default-Aliase), `lib/utils.ts`, ergänzte `app/globals.css` um Theme-Tokens,
   installierte `@base-ui/react`, `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css`.
   (Hinweis: `-y` allein reicht in 4.21.0 NICHT — ohne `-b`/`--preset` bleibt der Prompt hängen;
   `--preset base-nova` ist invalid, korrekter Preset-Name ist `nova`.)
4. Lokales Registry-Hosting: `npx serve` reicht NICHT (CLI 4.x erwartet Item-Payloads unter der
   URL-Vorlage des Registry-Eintrags, Payloads liegen aber unter `public/r/`). Stattdessen
   Node-Inline-Server (`e2e-install-check/registry-server.mjs`, Port 8490):
   - `GET /registry.json` → Worktree-Root `registry.json`
   - `GET /<name>.json` → Worktree `public/r/<name>.json`

   Verifiziert: `registry.json` 200 (55 Items), `data-grid.json` 200 (768 kB, Inhalte embedded),
   unbekannter Name 404.
5. `components.json` des Testprojekts: Eintrag
   `"registries": { "@gridcn": "http://localhost:8490/{name}.json" }` ergänzt (einzige
   Harness-Konfiguration — in Produktion löst die CLI `@gridcn` via gridcn.vercel.app, s. Abweichung 2).
6. Baseline-Commit im Testprojekt (`git init` + Commit vor der Installation).
7. `npx -y shadcn@latest add @gridcn/data-grid -y`.
8. `pnpm build` (1× direkt nach Install mit Platzhalter-Page, dann 1× mit Quickstart-Page).
9. `next start -p 3111` + Browser-Check via agent-browser + Screenshot.
10. `npx shadcn@latest registry validate --cwd <worktree>`: `√ Registry is valid. (55 items)`, Exit 0.

## CLI-4.21.0-Mechanik (aus dem CLI-Dist-Code verifiziert, relevant für den Install-Vertrag)

- Es gibt kein `registry`-Feld und kein `--registry`-Flag mehr (die Plan-Annahme aus der 2.x-Ära).
  Stattdessen: `registries`-Map in `components.json`, Key `@<name>`, Wert URL-Vorlage mit `{name}`-
  Platzhalter (genau das Format, das das gridcn-Repo selbst in seiner `components.json` für
  `@diceui`/`@ncdai` nutzt).
- Der Add-Befehl ist namespaced: `npx shadcn add @gridcn/data-grid`. Ein nacktes `data-grid`
  würde gegen das offizielle @shadcn-Registry (ui.shadcn.com) aufgelöst, nicht gegen den lokalen Server.
- `registryDependencies` des Items (`button`, `input`, `select`, `checkbox`, `popover`, `calendar`,
  `dropdown-menu`, `context-menu`, `separator`, `tooltip`) wurden von der CLI über das offizielle
  @shadcn-Registry (Style `base-nova`, Netzwerk) aufgelöst. Der `data-grid`-Payload selbst kam zu
  100 % vom lokalen Server.

## Install-Ergebnis

**104 Dateien angelegt** (CLI-Output "Created 104 files"):

- 94 × `components/data-grid/**` (93 Code-Dateien + `LICENSE.md`) — exakt die `files[]`-Liste des
  `data-grid`-Items.
- 10 × `components/ui/{button,input,select,checkbox,popover,dropdown-menu,context-menu,separator,tooltip,calendar}.tsx`
  (offizielles shadcn-Registry, Style `base-nova`).

**`package.json`-Delta** (von der CLI via `pnpm add` geschrieben):

| Dependency | Version | Herkunft |
|---|---|---|
| `zustand` | `^5.0.15` | von `data-grid` deklariert (die eine gridcn-eigene Dependency) |
| `react-day-picker` | `^10.0.1` | eigene Dependency des shadcn-`calendar`-Items |
| `date-fns` | `^4.4.0` | eigene Dependency des shadcn-`calendar`-Items |

`pnpm-lock.yaml`: +67 Zeilen. Keine weiteren Änderungen durch die Installation.

**Integritäts-Check:** 94/94 Payload-Dateien installiert, 0 fehlend. Inhaltlich: 74/94 byte-identisch
(EOL-normalisiert). Bei 20 Dateien hat die CLI den **führenden File-Header-Kommentar** entfernt
(nachgewiesen: Diff = exakt Header-Kommentar-Removal, Code-Teile identisch). Das ist CLI-Verhalten
(kosmetisch, keine Semantik-Änderung), kein Registry-Defekt.

## Build-Ergebnis

- **Build 1** (direkt nach Install, Platzhalter-`page.tsx`, **null manuelle Änderungen**):
  `pnpm build` → **Exit 0** (Next.js 16.3.5 Turbopack, TypeScript-Check über alle installierten
  Dateien grün). Next hat `tsconfig.json` selbst nachjustiert (`jsx` → `react-jsx`, `.next/dev/types`
  zu `include`) — das ist Next-Build-Verhalten, keine manuelle Änderung.
- **Build 2** (nach Quickstart-Page, s. u.): `pnpm build` → **Exit 0**.

## Render-Ergebnis

`app/page.tsx` + `app/columns.ts` = Quickstart-Snippet aus `content/docs/quick-start.mdx`
1:1 übernommen (das dokumentierte "Verify"-Verfahren aus `installation.mdx`). Das ist
Verwendungs-Code, keine Konfiguration — das `data-grid`-Item liefert bewusst keine Page.

`next start -p 3111` (Production-Server), agent-browser-Snapshot auf `/`:

- `role=grid` vorhanden
- 3 × `columnheader`: Name / Age / Active
- 3 × Datenzeilen: Ada Lovelace (28, checkbox checked), Grace Hopper (34, checked),
  Katherine Johnson (41, unchecked)
- Screenshot: `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\data-grid-e2e-screenshot.png`

CLI-Hinweis nach dem Add: `TooltipProvider`-Wrapper (Standard-shadcn-Tooltip-Contract). Die Page
rendert **ohne** diesen Wrapper stabil — der Provider ist für die Grid-Rendering nicht nötig.

## Abweichungen vom Aufgaben-/Plan-Text (CLI-Version, nicht Registry-Defekt)

1. `components.json`-Feld `registry` / `--registry`-Flag existieren in CLI 4.21.0 nicht mehr →
   `registries`-Map mit `{name}`-Vorlage. Der eine Eintrag im Testprojekt ist Test-Harness
   (zeigt auf localhost statt gridcn.vercel.app), keine App-Konfiguration.
2. Install-Befehl: `npx shadcn add @gridcn/data-grid` (namespaced) statt `add data-grid` —
   entspricht exakt dem in `installation.mdx`/`quick-start.mdx` dokumentierten Befehl.
3. `npx serve` auf Worktree-Root nicht geeignet (Payloads unter `public/r/`) → Node-Inline-Server
   (Plan-Variante "oder Node-Inline-Server").
4. CLI streift führende File-Header-Kommentare bei 20/94 installierten Dateien (nur Kommentare).

## Aufräum-Status

- Registry-Server (8490) und Next-Server (3111) gestoppt.
- Testprojekt bleibt unter `C:\Users\dahe\AppData\Local\Temp\opencode\e2e-install-check\`
  (`test-app/` + `registry-server.mjs`, `registry-server.log`, `next-server.log`,
  `data-grid-e2e-screenshot.png`).
- Im Worktree wurde genau eine Datei neu angelegt: dieser Report.
