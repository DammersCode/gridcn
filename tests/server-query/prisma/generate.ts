import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Vitest `globalSetup` of the conformance project: generates the Prisma clients the Prisma harnesses import. */
export default function generatePrismaClients(): void {
  const cli = join(dirname(createRequire(import.meta.url).resolve("prisma/package.json")), "build", "index.js");
  const started = Date.now();
  for (const provider of ["sqlite", "postgresql"]) {
    // The JS CLI through `node`, not the `.cmd` shim: a shim needs a shell on Windows, and the timeout would kill the shell only.
    execFileSync(process.execPath, [cli, "generate", "--schema", join(here, `${provider}.prisma`)], {
      env: { ...process.env, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      stdio: "pipe",
      timeout: Math.max(1, 60_000 - (Date.now() - started)),
    });
  }
}
