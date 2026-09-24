# Plan 015 — Lazy Loading Customizability: Gap-Evaluation + Umsetzung

Branch: `feat/lazy-customization` (Worktree `C:\Users\dahe\AppData\Local\Temp\opencode\gridcn-lazy-cust`).
Voraussetzung: `main` @ `c06bd47`. Alle Anker (file:line) gelten zu diesem Commit.
Jeder Executor: diesen Plan komplett lesen, nur seinen Task-Block ausführen,
STOP-Bedingungen einhalten. Nichts pushen.

## Ergebnis der Evaluation (Gap-Liste)

Customizability-Fläche heute: `total`, `fetchRows(start,end,signal)` (opakes Seams),
`getRowId`, `overscan` (Default 30 Zeilen), `batchSize` (Default 50 Zeilen), `onError`.
Range-Größe ist also **in Zeilen einstellbar** (overscan ± batchSize-Rundung), aber nicht
viewport-relativ und ohne Obergrenze pro Request.

| # | Gap | UX | DX | Entscheidung |
|---|-----|----|----|--------------|
| G1 | Kein Eviction/Retention — geladene Zeilen bleiben bis `total`-Wechsel/Remount (use-data-grid-lazy-rows.ts:82, :97-105) | Durchscrollen von 100k+ Zeilen hält am Ende ALLES im Speicher → Prämise "too large to load up front" bricht | `lazy-loading-advanced.mdx:60-61` verspricht "evicted by your own eviction policy" — API dafür existiert nicht (Dok-Lüge) | `evict(range)` + `getLoadedRanges()` (additiv); Consumer implementiert die Policy |
| G2 | Kein `maxFetchRows` — `expandRange` rundet nur auf, begrenzt nie (range-math.ts:20-30) | Große Einzel-Requests → lange Skeleton-Phasen | Server-Payload-Limits nur über Verrenkungen im `fetchRows`-Seams darstellbar | `maxFetchRows?` (Default: kein Cap); Gap wird in aufeinanderfolgende Chunks gesplittet |
| G3 | Kein imperatives `reset()` — dokumentierte Wege: Remount-per-`key` (lazy-loading.mdx:141-149) oder destruktiver `total`-Wechsel | — | Remount-Hack ist der dokumentierte Reset für Sort-Changes; "gleiche total, neue Inhalte" (Refresh) nicht sauber darstellbar | `reset(): void` (additiv), teilt den Code-Pfad des total-Change-Resets (:98-105) |
| G4 | Ladezustand opak — nur `unloadedCount` (:204); loadedRanges bewusst in Ref (:84-89: Dedup muss same-tick sein, Completion-Callbacks kein Extra-Render) | Kein per-Range-Fortschritt/Toast | Policy (G1) und Cache-Warming ohne Einblick in geladene Ranges unmöglich | `getLoadedRanges()` (Snapshot, nicht reaktiv) + `onLoaded?(range)` |
| G5 | Koncurrency-Cap fehlt; `total`-Wechsel = voller Reset; statische Parameter (keine Function-Form) | — | — | **SKIP** (unten) |

### Entscheidungen & Rationale

- **G1+G4 als primitives Paar:** `evict(range: Range)` + `getLoadedRanges(): readonly Range[]`.
  Die Hook liefert Bausteine, KEINE automatische Eviction-Engine (Speicher-Policy ist
  Consumer-Entscheid: LRU nach Scroll-Distanz, Viewport-Fenster, …). `evict` macht geladene
  Zeilen in `range` zu Holes und entfernt sie aus `loadedRangesRef` (Teil-Overlap: nur der
  Schnitt, Rest bleibt geladen; Mathematik über bestehende `subtractRanges`/`mergeRanges`,
  range-math.ts:37-85). `unloadedCount` rechnet sich von selbst (:204). Semantik:
  - `evict` abortet **keine** in-flight Fetches; ein in-flight Fetch auf den evizten Range
    landet normal und markiert ihn wieder geladen ("in-flight wins over evict").
  - Evictete Zeilen verlieren auch per `onDataChange` gemergte, nicht persistierte Edits —
    die Hook besitzt die Persistenz nicht (bestehender Edit-Vertrag, lazy-loading.mdx:98-103).
  - `getLoadedRanges` ist ein Snapshot (`.slice()`), **nicht reaktiv**: JSDoc vermerkt
    "call in effects or handlers — the result does not trigger a render".
- **G2 `maxFetchRows?: number`:** Default undefined = kein Cap (heutiges Verhalten).
  Überschreitet der erweiterte+gerundete Gap das Cap, splittet `chunkRange` (NEU, pure
  Funktion in range-math.ts) ihn in aufeinanderfolgende Chunks von ≤ Cap; jeder Chunk ist
  ein eigenständiger `runFetch` (eigene Dedup-Key, eigener AbortController, eigenes
  Failure-Verhalten). Chunk-Grenzen folgen dem Gap-Start, nicht batchSize-Grenzen —
  Dedup-Keys bleiben exakt. Guard `Math.max(1, maxFetchRows)` wie das bestehende
  `Math.max(1, batchSize)` (range-math.ts:23).
- **G3 `reset(): void`:** derselbe Pfad wie der total-Change-Reset (abort all in-flight,
  clear `loadedRangesRef`, `setRows(new Array(total))`, `setIsLoading(false)`). Code aus
  :98-105 in einen `useCallback` extrahieren; total-Change-Block und `reset()` teilen ihn.
  Stabile Funktion → kein Effect-Churn.
- **`onLoaded?: (range: Range) => void`:** Option; fired in `handleFulfilled` (:132-152)
  NACH dem Write mit dem **tatsächlich geschriebenen** Range (kurze Responses werden
  geclamped, :135) — `written === 0` → kein Call; kein Call bei Abort/Rejection.
  Ref-Pattern wie `onErrorRef` (:109-110).
- **Alle neuen Member stehen am Result-Root** (neben `onDataChange`/`unloadedCount`/
  `isLoading`), NICHT in `gridProps` — `gridProps` wird per Spread auf `<DataGrid>` gelegt;
  eigene Methoden dort wären DOM-Prop-Pollution. `gridProps`-Shape ändert sich NICHT.
- **Barrel/Registry:** keine neuen Files. `Range` ist bereits exportiert
  (data-grid-lazy.ts:9); Options/Result-Typen auch. Payload-Files
  `use-data-grid-lazy-rows.ts` + `range-math.ts` ändern sich → `pnpm registry:build` +
  `node scripts/normalize-payload-eol.mjs` + `git add public/r` + `pnpm registry:verify`.
  Docs: AutoTypeTable rendert die neuen Optionen automatisch (lazy-loading.mdx:71,
  api-reference.mdx:285).

### Explizit übersprungen (mit Upgrade-Pfad)

- **Koncurrency-Cap (`maxConcurrentFetches`):** Queue bricht die In-Flight-Buchhaltung auf
  (`inFlightRef` ≠ "tatsächlich in flight"; `isLoading`/Abort/Unmount-Pfade ändern sich).
  Dedup + Batch-Rundung halten die Request-Anzahl praktisch niedrig. Upgrade: echter
  Consumer mit Rate-Limit → dann eigene Spec.
- **Auto-Eviction (`maxLoadedRows`/Retention-Optionen):** Distanz-Tracking pro
  Scroll-Tick + Interaktion mit Sichtfenster/In-Flight = Komplexität ohne konkreten
  Consumer-Bedarf. `evict` + `getLoadedRanges` geben dem Consumer die Primitiven.
- **Viewport-relatives `overscan: { viewports: n }`:** die Hook sieht das Viewport nicht;
  der Core passt das Rendered-Window bereits per Velocity an (use-row-window.ts:51-71).
- **Function-Form für `overscan`/`batchSize`/`maxFetchRows`:** YAGNI.
- **Inkrementelles `total`-Wachstum (Cache behalten):** ein neuer `total` kann ein anderes
  Dataset bedeuten — volles Reset bleibt korrekt und wird dokumentiert, nicht "verbessert".

## Task 1 — Hook-API + Tests (Agent: `general`, TDD-Brief)

Scope: `registry/default/blocks/data-grid-lazy/` NUR. Reihenfolge: Tests zuerst (rot),
dann Implementation (grün).

1. **`range-math.ts`:** NEU `chunkRange(range: Range, max: number): Range[]` —
   aufeinanderfolgende Chunks von ≤ `max`, decken den Range exakt einmal ab;
   `max >= size` → ein Chunk. Tests in `range-math.test.ts` (unter/im/über Cap, Cap 1,
   degenerierter Range).
2. **`use-data-grid-lazy-rows.ts`:**
   - Options: `maxFetchRows?: number`, `onLoaded?: (range: Range) => void` (JSDoc je
     exported Symbol, Repo-Konvention).
   - Result: `reset(): void`, `evict(range: Range): void`,
     `getLoadedRanges(): readonly Range[]` — alle `useCallback` mit `[]` (stabil), JSDoc
     mit den Semantik-Entscheidungen von oben.
   - Total-Change-Block (:98-105) → extrahierter `clearAll`; `reset()` = `clearAll`.
   - `evict`: Clamp auf `[0, total]`, leer → no-op; `loadedRangesRef` =
     `mergeRanges` der via `subtractRanges` gehaltenen Pieces; `setRows` schreibt
     `undefined` in den Schnitt (Array-Länge bleibt konstant).
   - `handleFulfilled`: nach dem Write `onLoadedRef.current?.({start: range.start,
     end: range.start + written})`, nur wenn `written > 0`.
   - `onRowWindowChange`: `for (const gap of gaps) for (const chunk of
     chunkRange(gap, max)) runFetch(chunk)`; `maxFetchRows` in die Deps.
   - NEU `use-data-grid-lazy-rows.test.ts`-Cases:
     - `reset()`: in-flight wird abgebrochen, `unloadedCount` → `total`, nächstes
       `onRowWindowChange` holt neu (fetchRows 2×).
     - `evict()`: Holes + `unloadedCount`-Anstieg; Folge-`onRowWindowChange` re-fetched;
       Teil-Overlap hält den Rest; in-flight Range evicten → Fetch landet trotzdem;
       evicten von bereits unloaded/out-of-range = no-op.
     - `getLoadedRanges()`: merged Snapshot; leer nach `reset()`; Kopie (Mutation des
       Returns ändert die interne Buchhaltung nicht).
     - `onLoaded`: fired mit geschriebenem Range; kurze Response → geklammert;
       `written = 0` → kein Call; Abort/Rejection → kein Call.
     - `maxFetchRows`: ein Gap > Cap feuert N Fetches à ≤ Cap, zusammen exakt den Gap
       deckend; bereits gedeckte Chunks werden nicht doppelt geholt (Dedup bleibt).
3. **Browser-Test** NEU in `data-grid-lazy.browser.test.tsx` (Harness :30-48 erweitern,
   z. B. `onLazy?: (l: UseDataGridLazyRowsResult<Row>) => void`-Prop): scrollen → fetch
   resolve → Zeilen sichtbar; `evict` auf den sichtbaren Range; weg- und
   zurückscrollen → Skeletons (`[data-skeleton]` + `aria-busy`, Muster :73-76) →
   resolve → Zeilen wieder. Beweist den UX-Pfad: eviziert = Skeletons, kein Crash.
4. Gates: `pnpm types:check`, `pnpm lint`, `pnpm lint:typed`,
   `npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage`,
   `npx vitest run --project browser`, dann `pnpm registry:build && node
   scripts/normalize-payload-eol.mjs && git add public/r && pnpm registry:verify`.
5. Commit: `feat(data-grid-lazy): add reset, evict, getLoadedRanges, onLoaded, and maxFetchRows`

STOP: bestehende Tests rot, ohne dass die API es erfordert → nicht umschreiben, Report.
`gridProps`-Shape darf sich NICHT ändern (Spread-Vertrag).

## Task 2 — Validierungs-Sweep (Agent: `explore`, READ-ONLY, parallel zu Task 1)

Liefert die Punch-list als FINAL MESSAGE; der Orchestrator hängt sie als Abschnitt
`## Punch-list Task 3` in diese Datei an. Keine Repo-Änderung.

1. Alle file:line-Anker dieses Plans gegen den aktuellen HEAD verifizieren (Dateien:
   `use-data-grid-lazy-rows.ts`, `range-math.ts`, `data-grid-lazy.ts`,
   `lazy-loading.mdx`, `lazy-loading-advanced.mdx`).
2. `git grep -n "useDataGridLazyRows\|data-grid-lazy" content app registry scripts` →
   jeden Hit bewerten: welche Aussage ändert sich durch die neue API? Bekannte
   Kandidaten: lazy-loading-advanced.mdx:58-62 (Eviction-Satz), lazy-loading.mdx:158-160
   ("only drops loaded ranges when total changes"), :141-149 (Remount-key),
   plain.mdx:45-48 (Behavior reference), api-reference.mdx:280-285.
3. `git grep -n "remount\|evict\|unloaded" content/docs` → weitere Claims finden, die
   Task 3 korrigieren muss.
4. api-reference.mdx: rendert dort auch die Result-Typ-Tabelle (AutoTypeTable für
   `UseDataGridLazyRowsResult`)? → neue Fields automatisch dabei?
5. CHANGELOG.md: `## Unreleased`-Struktur (Added/Changed/Fixed) für den Task-3-Eintrag
   bestätigen.
6. `registry.json`: `data-grid-lazy`-Item — bestätigt, dass nur die 4 bekannten Files im
   Payload sind (keine vergessene Datei).

## Task 3 — Docs, CHANGELOG (Agent: `general`, nach Task 1+2)

Scope: `content/docs/**` + `CHANGELOG.md`. Demo `data-grid-lazy-demo.tsx` bleibt
UNBERÜHRT (Entscheidung: das Demo zeigt den Error-Pfad; Tuning-Knobs würden es
bloßen — die Dok-Snippets tragen es).

1. `lazy-loading.mdx`:
   - NEUE Sektion "Memory & retention" (vor "Sorting a lazy grid"): `reset`, `evict`,
     `getLoadedRanges`, je eine Satz-Intro (simple-english-Konvention) + ein
     Policy-Beispiel (Consumer eviziert Ranges > N Zeilen vom aktuellen
     `onRowWindowChange`-Fenster).
   - NEUE Sektion "Tuning the fetch window": `overscan`/`batchSize`/`maxFetchRows` —
     was jede Größe, ein Beispiel mit Nicht-Default-Werten.
   - "How it fetches"-Bullets (:73-93): `maxFetchRows` + `onLoaded` ergänzen.
   - Sort-Sektion: `reset()` als primären Reset-Weg; Remount-per-`key` als schwerere
     Alternative (setzt auch Core-Store) vermerken.
   - `onLoaded` in der Errors-Sektion (:105-124) als Success-Gegenstück erwähnen.
2. `lazy-loading-advanced.mdx:58-62`: Eviction-Satz auf das ECHTE API umschreiben
   (`evict` + `getLoadedRanges` + React-Query-Cache-Bezug).
3. `examples/data/lazy/plain.mdx:45-48`: Behavior-Reference auf die neuen Sektionen
   verlinken.
4. `CHANGELOG.md` → `## Unreleased` → `### Added`: Eintrag für `data-grid-lazy` (neue
   Options `maxFetchRows`/`onLoaded`, neue Result-Methoden `reset`/`evict`/
   `getLoadedRanges`; Style wie bestehende Einträge :14-29).
5. Alle Punch-list-Items aus Task 2 abarbeiten.
6. Gates: `pnpm types:check`, `pnpm lint`, `pnpm lint:typed`, `pnpm build`
   (MDX-Falle: offene Component-Tags findet nur der Build).
7. Commit: `docs(data-grid-lazy): document fetch-window tuning and memory retention`

## Task 4 — Two-Axis-Review (Agent: `general`, nach Task 3)

`code-review`-Skill auf `git diff <plan-commit>..HEAD`: Standards-Achse (Repo-Konventionen:
JSDoc, Comments-ohne-Warum weg, Konventional-Commits, Barrel-Surface) + Spec-Achse
(Semantik-Entscheidungen oben eingehalten, Tests decken die STOP-Kriterien ab).
Findings direkt beheben. Commit: `fix(data-grid-lazy): <Folge aus Review>` (falls nötig).

## Fleet & Parallelisierung

| Stufe | Task | Agent-Typ | Parallel zu | Toucht |
|-------|------|-----------|-------------|--------|
| 1a | T1 Implementer (TDD) | `general` | 1b | `registry/default/blocks/data-grid-lazy/**` + `public/r` |
| 1b | T2 Auditor (read-only) | `explore` | 1a | nichts (Punch-list als Final Message) |
| 2 | T3 Docs + CHANGELOG | `general` | — | `content/docs/**`, `CHANGELOG.md` |
| 3 | T4 Review | `general` | — | Review-Fixes |

- T1 und T2 laufen parallel: T2 ist read-only → keine Dateikonflikte.
- T3 erst nach T1 (API-Shape) UND T2 (Punch-list). T4 zuletzt.
- Konflikt-Regel: nur T1 toucht `registry/`; nur T3 toucht `content/docs` +
  `CHANGELOG.md`. `package.json` toucht niemand.
- Fleet-Mechanik: dieser Plan ist der einzige Brief — jeder Agent liest nur seinen
  Task-Block + die Entscheidungen oben (014-Konvention: "Every plan is self-contained —
  the executor has not seen the audit session").
- Flak-Regel: Browser-Projekt flaked → ein fehlgeschlagener Test genau EINMAL neu
  ausführen, bevor debuggt wird (AGENTS.md, Environment).

## Erwartete Commits

1. `feat(data-grid-lazy): add reset, evict, getLoadedRanges, onLoaded, and maxFetchRows` (T1)
2. `docs(data-grid-lazy): document fetch-window tuning and memory retention` (T3)
3. optional `fix(data-grid-lazy): <Review-Folge>` (T4)

Finale Gates nach ALLEN Tasks: `pnpm types:check && pnpm lint && pnpm lint:typed &&
npx vitest run registry --exclude "**/*.browser.test.*" --project unit --coverage &&
nix vitest run --project browser && pnpm registry:verify` — dann `git log` gegen
dieses Plan-File abgleichen.

## Punch-list Task 3 (aus dem T2-Validierungs-Sweep, read-only @ c06bd47)

Alle Plan-Anker verifiziert: OK (keine Drifts). Registry-Item `data-grid-lazy`:
genau die 4 bekannten Payload-Files bestätigt.

1. `content/docs/lazy-loading-advanced.mdx:58-62` — Eviction-Satz
   ("a range evicted by your own eviction policy") auf das ECHTE API umschreiben:
   `evict(range)` + `getLoadedRanges()`; Policy ist Consumer-Entscheid; evizter Range
   kommt aus dem React-Query-Cache zurück, solange innerhalb `staleTime`.
2. `content/docs/lazy-loading.mdx:158-160` — "only drops loaded ranges when `total`
   changes. Remounting on a key … is the way to clear them." → STALE: `reset()`
   klärt jetzt alle geladenen Ranges über denselben Code-Pfad; Remount-per-key wird
   zur schwereren Alternative (setzt auch den Core-Store).
3. `content/docs/lazy-loading.mdx:141-149` — Remount-key-Snippet: `reset()` als
   primären Sort-Change-Reset; Remount als Alternative mit Caveat vermerken.
4. `content/docs/lazy-loading.mdx:192` — "or track the loaded ranges in your own
   state." → STALE: `getLoadedRanges()` liefert die Ranges (Snapshot, nicht
   reaktiv — in Effects/Handlers aufrufen, kein Re-Render).
5. `content/docs/examples/data/lazy/plain.mdx:45-48` — Behavior reference: Verweis
   auf die neuen Sektionen "Memory & retention" + "Tuning the fetch window" ergänzen.
6. `content/docs/api-reference.mdx:280-285` — nur die Options-Tabelle rendert;
   `UseDataGridLazyRowsResult` steht nirgends → NEU `### UseDataGridLazyRowsResult` +
   `<AutoTypeTable … name="UseDataGridLazyRowsResult" />` ergänzen, sonst bleiben
   `reset`/`evict`/`getLoadedRanges` undokumentiert.

CHANGELOG: `## Unreleased` → erstes `### Added` (:12) als Ziel; Style wie :14-29.
Bestehender lazy-Eintrag unter dem zweiten `### Added` (:66, Eintrag :73-74) —
belassen, nicht "fixen".
