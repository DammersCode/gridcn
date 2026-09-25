#!/usr/bin/env node
// End-to-end consumer smoke test: serves public/r locally, scaffolds a fresh Next.js app,
// `shadcn add`s real registry items through the CLI (not just static resolution, unlike
// verify-demo-install.mjs), renders one page per installed demo, then builds and boots the
// app and fetches every page expecting HTTP 200 with no error markers in the HTML.
//
// Usage:
//   node scripts/verify-e2e-install.mjs [items...]   # default: changed-addon demos + data-grid-demo
//   node scripts/verify-e2e-install.mjs --all        # every registry:example item
//   node scripts/verify-e2e-install.mjs --reuse ...  # reuse a cached scaffold dir between runs
//
// All long-running commands run under a hard timeout with output redirected to a log file
// under LOG_DIR; only tails/greps of those logs are ever printed.
import { spawn, execSync, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import net from "node:net";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Windows dev default matches the documented temp convention; CI (ubuntu-latest) uses os.tmpdir().
const LOG_DIR = process.env.GRIDCN_E2E_LOG_DIR ?? (process.platform === "win32"
  ? "C:\\Users\\dahe\\AppData\\Local\\Temp\\gridcn-e2e"
  : join(tmpdir(), "gridcn-e2e"));
mkdirSync(LOG_DIR, { recursive: true });

const args = process.argv.slice(2);
const reuse = args.includes("--reuse");
const all = args.includes("--all");
const itemArgs = args.filter((a) => a !== "--reuse" && a !== "--all");

function log(msg) {
  console.log(msg);
}

// Synchronous: an async spawn() here can race process.exit() during final cleanup and crash
// Node's event loop (libuv UV_HANDLE_CLOSING assertion) when a new handle opens mid-teardown.
function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL"); // negative pid: whole process group (spawned with detached below)
    }
  } catch {}
}

function tailFile(path, n = 60) {
  if (!existsSync(path)) return "(no log)";
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  return lines.slice(-n).join("\n");
}

function grepFile(path, pattern) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  return text.split(/\r?\n/).filter((l) => pattern.test(l));
}

// Runs a command with a hard timeout, streaming stdout+stderr to a log file. Never buffers
// full output in memory beyond what's needed for the exit summary.
function run(cmd, cmdArgs, { cwd, logFile, timeoutMs, env }) {
  return new Promise((resolve) => {
    const fd = openSync(logFile, "w");
    const child = spawn(cmd, cmdArgs, {
      cwd,
      shell: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, ...env },
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      closeSync(fd);
      resolve({ code: timedOut ? -1 : code, timedOut });
    });
    child.on("error", () => {
      clearTimeout(timer);
      try {
        closeSync(fd);
      } catch {}
      resolve({ code: -1, timedOut: false });
    });
  });
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function serveDir(dir, port) {
  const MIME = { ".json": "application/json", ".css": "text/css", ".js": "text/javascript" };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
    const filePath = join(dir, rel);
    if (!filePath.startsWith(dir) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    // Payload deps name the GitHub registry; left as-is, the CLI installs them from main instead of this build.
    const body = readFileSync(filePath);
    res.end(ext === ".json" ? body.toString("utf8").replaceAll('"DammersCode/gridcn/', '"@gridcn/') : body);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function waitForHttp200(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --- 1. Determine item set ------------------------------------------------------------------
const registry = JSON.parse(readFileSync(join(root, "registry.json"), "utf8"));
const exampleNames = new Set(registry.items.filter((i) => i.type === "registry:example").map((i) => i.name));

// Default set: data-grid-demo plus the example items whose own source file, or a
// registry:block/lib item they depend on, changed vs. origin/main. Best-effort — falls back to
// just data-grid-demo when git diff is unavailable (e.g. a shallow clone with no base ref).
function changedAddonDemos() {
  let changedFiles;
  try {
    execSync("git rev-parse --verify origin/main", { cwd: root, stdio: "ignore" });
    changedFiles = execSync("git diff --name-only origin/main...HEAD -- registry/", { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
  if (changedFiles.length === 0) return [];

  const itemsByName = new Map(registry.items.map((i) => [i.name, i]));
  const changedItemNames = new Set();
  for (const file of changedFiles) {
    for (const item of registry.items) {
      if ((item.files ?? []).some((f) => f.path === file)) changedItemNames.add(item.name);
    }
  }

  const examples = registry.items.filter((i) => i.type === "registry:example");
  const affected = new Set();
  for (const example of examples) {
    const closure = new Set([example.name]);
    const queue = [example];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const dep of current.registryDependencies ?? []) {
        const localName = dep.includes("/") ? dep.slice(dep.lastIndexOf("/") + 1) : dep;
        const depItem = itemsByName.get(localName);
        if (depItem && !closure.has(localName)) {
          closure.add(localName);
          queue.push(depItem);
        }
      }
    }
    if ([...closure].some((n) => changedItemNames.has(n))) affected.add(example.name);
  }
  return [...affected];
}

let items;
if (all) {
  items = [...exampleNames];
} else if (itemArgs.length > 0) {
  items = itemArgs;
} else {
  items = ["data-grid-demo", ...changedAddonDemos()];
}
items = [...new Set(items)];

for (const name of items) {
  if (!exampleNames.has(name)) {
    console.error(`Unknown registry:example item: "${name}" (not in registry.json)`);
    process.exit(1);
  }
}

log(`Items to install (${items.length}): ${items.join(", ")}`);

const timings = {};
function mark(label, fn) {
  return (async () => {
    const start = Date.now();
    const result = await fn();
    timings[label] = Date.now() - start;
    return result;
  })();
}

// --- 2. Serve public/r locally ---------------------------------------------------------------
const registryDir = join(root, "public", "r");
if (!existsSync(registryDir)) {
  console.error(`public/r not found at ${registryDir} — run pnpm registry:build first (this script does not build it).`);
  process.exit(1);
}
const registryPort = await getFreePort();
const registryServer = await serveDir(registryDir, registryPort);
log(`Serving public/r on http://127.0.0.1:${registryPort}`);

const problems = [];
let appPort = null;
let nextServerHandle = null;

try {
  // --- 3. Scaffold fresh Next.js app ----------------------------------------------------------
  const scaffoldDir = reuse ? join(tmpdir(), "gridcn-e2e-scaffold") : join(tmpdir(), `gridcn-e2e-scaffold-${Date.now()}`);
  const scaffoldExists = existsSync(join(scaffoldDir, "package.json"));

  if (!reuse || !scaffoldExists) {
    rmSync(scaffoldDir, { recursive: true, force: true });
    mkdirSync(scaffoldDir, { recursive: true });
    log(`Scaffolding Next.js app in ${scaffoldDir}`);
    const createLog = join(LOG_DIR, "create-next-app.log");
    const { code, timedOut } = await mark("scaffold", () =>
      run(
        "npx",
        [
          "--yes",
          "create-next-app@latest",
          ".",
          "--ts",
          "--tailwind",
          "--app",
          "--eslint=false",
          "--yes",
          "--use-npm",
          "--skip-install",
        ],
        { cwd: scaffoldDir, logFile: createLog, timeoutMs: 5 * 60_000 },
      ),
    );
    if (code !== 0) {
      console.error(`create-next-app failed (code ${code}${timedOut ? ", timed out" : ""}). Tail of ${createLog}:`);
      console.error(tailFile(createLog));
      process.exit(1);
    }

    const installLog = join(LOG_DIR, "npm-install.log");
    const installResult = await mark("npm-install", () =>
      run("npm", ["install"], { cwd: scaffoldDir, logFile: installLog, timeoutMs: 5 * 60_000 }),
    );
    if (installResult.code !== 0) {
      console.error(`npm install failed. Tail of ${installLog}:`);
      console.error(tailFile(installLog));
      process.exit(1);
    }

    const initLog = join(LOG_DIR, "shadcn-init.log");
    const initResult = await mark("shadcn-init", () =>
      run("npx", ["--yes", "shadcn@latest", "init", "-y", "-b", "base", "-d"], {
        cwd: scaffoldDir,
        logFile: initLog,
        timeoutMs: 3 * 60_000,
      }),
    );
    if (initResult.code !== 0) {
      console.error(`shadcn init failed. Tail of ${initLog}:`);
      console.error(tailFile(initLog));
      process.exit(1);
    }
  } else {
    log(`Reusing cached scaffold at ${scaffoldDir}`);
    timings.scaffold = 0;
    timings["npm-install"] = 0;
    timings["shadcn-init"] = 0;
  }

  // components.json registries: point the @gridcn namespace at the local server so
  // registryDependencies inside installed payloads resolve without touching the network.
  const componentsJsonPath = join(scaffoldDir, "components.json");
  const componentsJson = JSON.parse(readFileSync(componentsJsonPath, "utf8"));
  componentsJson.registries = {
    ...componentsJson.registries,
    "@gridcn": `http://127.0.0.1:${registryPort}/{name}.json`,
  };
  writeFileSync(componentsJsonPath, JSON.stringify(componentsJson, null, 2));

  // --- 4. shadcn add the requested items --------------------------------------------------
  const addLog = join(LOG_DIR, "shadcn-add.log");
  const addTargets = items.map((name) => `@gridcn/${name}`);
  const addResult = await mark("shadcn-add", () =>
    run("npx", ["--yes", "shadcn@latest", "add", ...addTargets, "--yes", "--overwrite"], {
      cwd: scaffoldDir,
      logFile: addLog,
      timeoutMs: 5 * 60_000,
    }),
  );
  if (addResult.code !== 0) {
    console.error(`shadcn add failed (code ${addResult.code}${addResult.timedOut ? ", timed out" : ""}). Tail of ${addLog}:`);
    console.error(tailFile(addLog));
    console.error("\nErrors matched in log:");
    for (const line of grepFile(addLog, /error|Error|ENOENT|not found/)) console.error(`  ${line}`);
    process.exit(1);
  }

  // --- 5. Generate one page per installed demo ----------------------------------------------
  // create-next-app may scaffold a src/ layout; App Router only honors one of app/ or src/app/,
  // and shadcn installs components under the matching root, so detect it instead of assuming.
  const usesSrcDir = existsSync(join(scaffoldDir, "src", "app"));
  const appDir = usesSrcDir ? join(scaffoldDir, "src", "app") : join(scaffoldDir, "app");
  const componentsDir = usesSrcDir ? join(scaffoldDir, "src", "components") : join(scaffoldDir, "components");
  const e2eDir = join(appDir, "e2e");
  rmSync(e2eDir, { recursive: true, force: true });
  const pageReports = [];
  for (const name of items) {
    const componentFile = join(componentsDir, `${name}.tsx`);
    if (!existsSync(componentFile)) {
      problems.push(`${name}: expected component file components/${name}.tsx was not installed by shadcn add`);
      continue;
    }
    const source = readFileSync(componentFile, "utf8");
    const hasDefaultExport = /export\s+default\s+/.test(source);
    let importLine;
    let renderExpr;
    if (hasDefaultExport) {
      importLine = `import Demo from "@/components/${name}";`;
      renderExpr = "<Demo />";
    } else {
      const namedMatch = source.match(/export\s+function\s+([A-Za-z0-9_]+)/);
      if (!namedMatch) {
        problems.push(`${name}: components/${name}.tsx has no default or named function export to render`);
        continue;
      }
      const fnName = namedMatch[1];
      importLine = `import { ${fnName} as Demo } from "@/components/${name}";`;
      renderExpr = "<Demo />";
    }
    const pageDir = join(e2eDir, name);
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(
      join(pageDir, "page.tsx"),
      `${importLine}\n\nexport default function Page() {\n  return ${renderExpr};\n}\n`,
    );
    pageReports.push(name);
  }

  if (pageReports.length === 0) {
    console.error("No demo pages could be generated; aborting before build.");
    console.error(problems.join("\n"));
    process.exit(1);
  }

  // --- 6. Typecheck --------------------------------------------------------------------------
  // next typegen writes .next/types (route/layout prop types like LayoutProps<"/">) that
  // create-next-app's own scaffolded files reference; plain tsc fails without it.
  const typegenLog = join(LOG_DIR, "next-typegen.log");
  const typegenResult = await mark("next-typegen", () =>
    run("npx", ["next", "typegen"], { cwd: scaffoldDir, logFile: typegenLog, timeoutMs: 2 * 60_000 }),
  );
  if (typegenResult.code !== 0) {
    problems.push(`next typegen failed (see ${typegenLog}):\n` + tailFile(typegenLog, 40));
  }

  const tscLog = join(LOG_DIR, "tsc.log");
  const tscResult = await mark("tsc", () =>
    run("npx", ["tsc", "--noEmit"], { cwd: scaffoldDir, logFile: tscLog, timeoutMs: 3 * 60_000 }),
  );
  if (tscResult.code !== 0) {
    problems.push(`tsc --noEmit failed (see ${tscLog}):\n` + tailFile(tscLog, 80));
  }

  // --- 7. next build ---------------------------------------------------------------------------
  const buildLog = join(LOG_DIR, "next-build.log");
  const buildResult = await mark("next-build", () =>
    run("npx", ["next", "build"], { cwd: scaffoldDir, logFile: buildLog, timeoutMs: 8 * 60_000 }),
  );
  if (buildResult.code !== 0) {
    problems.push(`next build failed (see ${buildLog}):\n` + tailFile(buildLog, 100));
  }

  // --- 8. next start + fetch each page ----------------------------------------------------------
  if (buildResult.code === 0) {
    appPort = await getFreePort();
    const startLog = join(LOG_DIR, "next-start.log");
    const startFd = openSync(startLog, "w");
    nextServerHandle = spawn("npx", ["next", "start", "-p", String(appPort)], {
      cwd: scaffoldDir,
      shell: true,
      stdio: ["ignore", startFd, startFd],
      detached: process.platform !== "win32",
    });

    const up = await mark("next-start-ready", () => waitForHttp200(`http://127.0.0.1:${appPort}/e2e/${pageReports[0]}`, 60_000));
    if (!up) {
      problems.push(`next start did not become ready on port ${appPort} within 60s (see ${startLog}):\n` + tailFile(startLog, 80));
    } else {
      for (const name of pageReports) {
        const url = `http://127.0.0.1:${appPort}/e2e/${name}`;
        try {
          const res = await fetch(url);
          const html = await res.text();
          // Next.js embeds a not-found/error boundary's fallback markup as inert RSC flight JSON
          // on every page (parallel-route slot), so raw substring checks false-positive on a
          // healthy page. Only the rendered <title> reliably reflects what the browser shows.
          const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
          const errorMarkers = [/^404:/i, /application error/i, /internal server error/i];
          const hit = errorMarkers.find((re) => re.test(title));
          if (res.status !== 200) {
            problems.push(`${name}: GET ${url} returned HTTP ${res.status}`);
          } else if (hit) {
            problems.push(`${name}: GET ${url} returned 200 but <title>"${title}"</title> matched error marker ${hit}`);
          }
        } catch (e) {
          problems.push(`${name}: GET ${url} failed: ${e.message}`);
        }
      }
    }
  } else {
    problems.push("Skipped next start + page fetch because next build failed.");
  }
} finally {
  killTree(nextServerHandle?.pid);
  registryServer.close();
}

// --- Report -----------------------------------------------------------------------------------
log("\n=== Timing (ms) ===");
for (const [label, ms] of Object.entries(timings)) log(`  ${label}: ${ms}`);

if (problems.length > 0) {
  console.error(`\n=== FAIL: ${problems.length} problem(s) ===`);
  problems.forEach((p, i) => console.error(`${i + 1}. ${p}`));
  process.exit(1);
}

log("\nAll items installed, typechecked, built, and served pages with HTTP 200 and no error markers.");
