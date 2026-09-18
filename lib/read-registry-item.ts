import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

/** The gridcn GitHub registry address — same-repo registry items are addressed as `<owner>/<repo>/<item>`. */
export const GRIDCN_REGISTRY = "DammersCode/gridcn";

/** One entry of a registry item's `files[]` — the exact shape the registry build emits into `public/r/<item>.json`. */
export type RegistryItemFile = {
  path: string;
  target: string;
  content: string;
  type: string;
};

/** The subset of a `public/r/<item>.json` payload a manual-install UI needs. */
export type RegistryItem = {
  name: string;
  files: RegistryItemFile[];
  dependencies: string[];
  devDependencies: string[];
  registryDependencies: string[];
};

/** Reads a built registry item's payload for the docs Manual tab — same JSON a consumer's CLI fetches from `/r/<item>.json`. */
export const readRegistryItem = cache((name: string): RegistryItem => {
  const filePath = path.join(process.cwd(), "public/r", `${name}.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<RegistryItem>;
  return {
    name: parsed.name ?? name,
    files: parsed.files ?? [],
    dependencies: parsed.dependencies ?? [],
    devDependencies: parsed.devDependencies ?? [],
    registryDependencies: parsed.registryDependencies ?? [],
  };
});
