import { createFileSystemGeneratorCache, createGenerator } from "fumadocs-typescript";

let cachedGenerator: ReturnType<typeof createGenerator> | null = null;

/** Shared TS-compiler generator; the file-system cache avoids re-running the compiler per page on every prerender pass. */
export function getTypeGenerator() {
  cachedGenerator ??= createGenerator({ cache: createFileSystemGeneratorCache(".next/fumadocs-typescript") });
  return cachedGenerator;
}
