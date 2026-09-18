import fs from "node:fs";
import path from "node:path";
import type { RegistryExampleName } from "@/components/registry-examples";

/** Reads a registry:example's installable source for the docs Code tab — same file the registry build inlines into its payload. */
export function readExampleSource(name: RegistryExampleName): string {
  const filePath = path.join(process.cwd(), "registry/default/examples", `${name}.tsx`);
  return fs.readFileSync(filePath, "utf-8");
}
