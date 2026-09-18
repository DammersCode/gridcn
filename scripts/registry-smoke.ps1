#!/usr/bin/env pwsh
<#
.SYNOPSIS
  End-to-end smoke test for the gridcn registry: builds it, serves it locally, and installs
  every registry:block item (derived from registry.json) plus data-grid-io-demo and
  data-grid-events-demo — the two demos with the most cross-add-on imports — into two fresh
  consumer apps (Next.js with default aliases, Vite with non-default "~/" aliases), then
  typechecks + builds both. Re-runnable — always scaffolds fresh consumer apps.

.PARAMETER WorkDir
  Directory to scaffold the two consumer apps into. Defaults to a temp folder. Never put this
  inside the repo.

.PARAMETER Port
  Local port to serve the built registry on. Default 3999.

.EXAMPLE
  pwsh ./scripts/registry-smoke.ps1
  pwsh ./scripts/registry-smoke.ps1 -WorkDir C:/temp/gridcn-smoke -Port 4100
#>
param(
  [string]$WorkDir = (Join-Path $env:TEMP "gridcn-registry-smoke"),
  [int]$Port = 3999
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Write-Step($msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Stop-PortListener([int]$port) {
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($conns) {
    $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
  }
}

# pnpm v10 blocks native postinstall scripts and (with strict config) exits 1 on the
# ignored-builds report. The setting's new home is pnpm-workspace.yaml (the package.json
# "pnpm" field is no longer read), and it must exist BEFORE the first install in the dir.
function Approve-NativeBuilds {
  @"
allowBuilds:
  sharp: true
  esbuild: true
  "@tailwindcss/oxide": true
  unrs-resolver: true
onlyBuiltDependencies:
  - sharp
  - esbuild
  - "@tailwindcss/oxide"
  - unrs-resolver
"@ | Set-Content pnpm-workspace.yaml -Encoding utf8
}

function Wait-ForHttp200([string]$url, [int]$timeoutSec = 20) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($resp.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Seconds 1
  }
  return $false
}

# 1. Verify + build the registry -------------------------------------------------------------
Write-Step "Verifying registry.json matches the filesystem"
Push-Location $repoRoot
node scripts/verify-registry.mjs
if ($LASTEXITCODE -ne 0) { throw "verify-registry.mjs found drift — fix registry.json before smoke testing." }

Write-Step "Building the registry (pnpm registry:build)"
pnpm registry:build
if ($LASTEXITCODE -ne 0) { throw "registry build failed." }
Pop-Location

# 2. Serve the registry ------------------------------------------------------------------------
Write-Step "Serving public/ on port $Port"
Stop-PortListener -port $Port
$serveLog = Join-Path $WorkDir "serve.log"
$serveErrLog = Join-Path $WorkDir "serve.err.log"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
# npx is a .cmd shim on Windows — Start-Process needs an actual executable, so go through cmd.exe.
$serveProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npx --yes serve `"$repoRoot/public`" -l $Port" `
  -RedirectStandardOutput $serveLog -RedirectStandardError $serveErrLog -PassThru -WindowStyle Hidden

$registryUrl = "http://localhost:$Port/r/data-grid.json"
if (-not (Wait-ForHttp200 -url $registryUrl)) {
  throw "Registry server did not come up at $registryUrl. See $serveLog"
}
Write-Host "Registry is up at http://localhost:$Port/r/{name}.json"

$namespaceArg = "@gridcn=http://localhost:$Port/r/{name}.json"

# Derive the install list from registry.json rather than hardcoding it, so new items are
# covered the day they're added (workplan #82) — install every registry:block item (the add-ons
# consumers actually `shadcn add`) plus two demos with the most cross-add-on imports, which
# exercise the barrel-import rewrite end to end (fix-registry-imports.mjs) via a real CLI install.
$registryJson = Get-Content (Join-Path $repoRoot "registry.json") -Raw | ConvertFrom-Json
$blockItems = $registryJson.items | Where-Object { $_.type -eq "registry:block" } | ForEach-Object { "@gridcn/$($_.name)" }
$demoItems = "@gridcn/data-grid-io-demo", "@gridcn/data-grid-events-demo"
$items = @($blockItems) + $demoItems
Write-Host "Installing $($items.Count) items: $($items -join ', ')"

try {
  # 3. Consumer 1: Next.js (default aliases) ---------------------------------------------------
  Write-Step "Consumer 1: Next.js (default @/ aliases)"
  $nextDir = Join-Path $WorkDir "smoke-next"
  Remove-Item -Recurse -Force $nextDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $nextDir | Out-Null
  Push-Location $nextDir
  npx --yes create-next-app@latest . --ts --tailwind --app --no-eslint --use-pnpm --yes --skip-install
  if ($LASTEXITCODE -ne 0) { throw "create-next-app failed." }
  Approve-NativeBuilds
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (Next)." }

  npx --yes shadcn@latest init -y -b base -d
  if ($LASTEXITCODE -ne 0) { throw "shadcn init failed (Next)." }

  npx --yes shadcn@latest registry add $namespaceArg
  if ($LASTEXITCODE -ne 0) { throw "shadcn registry add failed (Next)." }

  npx --yes shadcn@latest add @($items) --yes --overwrite
  if ($LASTEXITCODE -ne 0) { throw "shadcn add failed (Next)." }

  Write-Host "Writing smoke page (src/app/page.tsx)"
  @'
"use client";

import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/components/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch } from "@/components/data-grid-toolbar/data-grid-toolbar";
import { useDataGridState } from "@/components/data-grid-history/data-grid-history";

interface Row {
  id: string;
  name: string;
  age: number;
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
]);

const initialRows: Row[] = [
  { id: "1", name: "Ada Lovelace", age: 36 },
  { id: "2", name: "Alan Turing", age: 41 },
  { id: "3", name: "Grace Hopper", age: 85 },
];

export default function Home() {
  const { data, getRowId, onDataChange, onUndo, onRedo } = useDataGridState(initialRows, {
    getRowId: (row: Row) => row.id,
  });

  return (
    <div className="p-8">
      <h1 className="mb-4 text-xl font-semibold">gridcn smoke test</h1>
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={getRowId}
        onDataChange={onDataChange}
        onUndo={onUndo}
        onRedo={onRedo}
      >
        <DataGridToolbar>
          <DataGridSearch />
        </DataGridToolbar>
        <DataGridRoot>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}
'@ | Set-Content -Path "src/app/page.tsx" -Encoding utf8

  Write-Host "Typechecking (tsc --noEmit)"
  npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw "tsc failed for Next consumer." }

  Write-Host "Building (pnpm build)"
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed for Next consumer." }

  Write-Host "Next.js consumer: PASS" -ForegroundColor Green
  Pop-Location

  # 4. Consumer 2: Vite (non-default "~/" aliases) ---------------------------------------------
  Write-Step "Consumer 2: Vite (non-default ~/ aliases — known CLI friction case)"
  $viteDir = Join-Path $WorkDir "smoke-vite"
  Remove-Item -Recurse -Force $viteDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $viteDir | Out-Null
  Push-Location $viteDir

  # Self-scaffold instead of `pnpm create vite`: newer create-vite versions add interactive
  # prompts that EOF-abort under a null stdin and leave a partial scaffold (2026-08-02 failure).
  # Every file the template would give us is written explicitly, so nothing interactive remains.
  Approve-NativeBuilds
  @'
{
  "name": "smoke-vite",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -b && vite build"
  }
}
'@ | Set-Content -Path "package.json" -Encoding utf8
  New-Item -ItemType Directory -Force -Path "src" | Out-Null
  @'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>smoke-vite</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'@ | Set-Content -Path "index.html" -Encoding utf8
  @'
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
'@ | Set-Content -Path "src/main.tsx" -Encoding utf8
  @'
function App() {
  return <div>placeholder - replaced by the smoke component</div>;
}
export default App;
'@ | Set-Content -Path "src/App.tsx" -Encoding utf8
  '/// <reference types="vite/client" />' | Set-Content -Path "src/vite-env.d.ts" -Encoding utf8
  pnpm add react react-dom
  if ($LASTEXITCODE -ne 0) { throw "pnpm add react failed (Vite)." }
  # typescript pinned to 5.x: TS 7 removed baseUrl (TS5102), which the shadcn alias resolver
  # and this scaffold's paths setup still use - same major create-vite's template pins.
  pnpm add -D vite "@vitejs/plugin-react" "typescript@5" "@types/react" "@types/react-dom" "@types/node"
  if ($LASTEXITCODE -ne 0) { throw "pnpm add dev deps failed (Vite)." }
  pnpm add tailwindcss @tailwindcss/vite
  if ($LASTEXITCODE -ne 0) { throw "pnpm add tailwind failed (Vite)." }

  Write-Host "Configuring Tailwind v4 + ~/ alias (tsconfig.json, tsconfig.app.json, vite.config.ts)"
  Set-Content -Path "src/index.css" -Value '@import "tailwindcss";' -Encoding utf8

  @'
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "ignoreDeprecations": "6.0",
    "baseUrl": ".",
    "paths": {
      "~/*": ["./src/*"]
    }
  }
}
'@ | Set-Content -Path "tsconfig.json" -Encoding utf8

  @'
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "~/*": ["./src/*"] }
  },
  "include": ["src"]
}
'@ | Set-Content -Path "tsconfig.app.json" -Encoding utf8

  @'
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
'@ | Set-Content -Path "tsconfig.node.json" -Encoding utf8

  @'
import path from "node:path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./src"),
    },
  },
})
'@ | Set-Content -Path "vite.config.ts" -Encoding utf8

  # NOTE (documented CLI friction): `paths` must be set in BOTH tsconfig.json AND
  # tsconfig.app.json — shadcn's alias resolver (tsconfig-paths) reads tsconfig.json directly and
  # does not follow "references". Vite's own docs already say to duplicate it; skipping the root
  # file causes `shadcn init` to write components.json with the LITERAL alias string unresolved,
  # which then makes `shadcn add` create files under a literal "~" directory instead of "src/".
  npx --yes shadcn@latest init -y -f --reinstall -b base -p nova -t vite
  if ($LASTEXITCODE -ne 0) { throw "shadcn init failed (Vite)." }

  npx --yes shadcn@latest registry add $namespaceArg
  if ($LASTEXITCODE -ne 0) { throw "shadcn registry add failed (Vite)." }

  npx --yes shadcn@latest add @($items) --yes --overwrite
  if ($LASTEXITCODE -ne 0) { throw "shadcn add failed (Vite)." }

  Write-Host "Writing smoke component (src/App.tsx)"
  @'
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "~/components/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch } from "~/components/data-grid-toolbar/data-grid-toolbar";
import { useDataGridState } from "~/components/data-grid-history/data-grid-history";

interface Row {
  id: string;
  name: string;
  age: number;
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
]);

const initialRows: Row[] = [
  { id: "1", name: "Ada Lovelace", age: 36 },
  { id: "2", name: "Alan Turing", age: 41 },
  { id: "3", name: "Grace Hopper", age: 85 },
];

function App() {
  const { data, getRowId, onDataChange, onUndo, onRedo } = useDataGridState(initialRows, {
    getRowId: (row: Row) => row.id,
  });

  return (
    <div className="p-8">
      <h1 className="mb-4 text-xl font-semibold">gridcn smoke test</h1>
      <DataGridProvider
        data={data}
        columns={columns}
        getRowId={getRowId}
        onDataChange={onDataChange}
        onUndo={onUndo}
        onRedo={onRedo}
      >
        <DataGridToolbar>
          <DataGridSearch />
        </DataGridToolbar>
        <DataGridRoot>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

export default App
'@ | Set-Content -Path "src/App.tsx" -Encoding utf8

  Write-Host "Typechecking (tsc --noEmit -p tsconfig.app.json)"
  npx tsc --noEmit -p tsconfig.app.json
  if ($LASTEXITCODE -ne 0) { throw "tsc failed for Vite consumer." }

  Write-Host "Building (pnpm build)"
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed for Vite consumer." }

  Write-Host "Vite consumer (non-default aliases): PASS" -ForegroundColor Green
  Pop-Location

  Write-Step "ALL CONSUMERS GREEN"
}
finally {
  if ($serveProc -and -not $serveProc.HasExited) {
    Stop-Process -Id $serveProc.Id -Force -ErrorAction SilentlyContinue
  }
  Stop-PortListener -port $Port
}
