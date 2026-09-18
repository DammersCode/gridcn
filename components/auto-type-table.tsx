import { createFileSystemGeneratorCache, createGenerator } from "fumadocs-typescript";
import { AutoTypeTable as AutoTypeTableImpl } from "fumadocs-typescript/ui";

let cachedGenerator: ReturnType<typeof createGenerator> | null = null;

function getGenerator() {
  if (!cachedGenerator) {
    // file-system cache avoids re-running the TS compiler API per page on every prerender pass
    cachedGenerator = createGenerator({ cache: createFileSystemGeneratorCache(".next/fumadocs-typescript") });
  }
  return cachedGenerator;
}

/** Server-component-only: generates a prop table from a real TS type at build time (see AutoTypeTableImpl). */
export function AutoTypeTable(props: Record<string, unknown>) {
  return (
    <div className="auto-type-table">
      <AutoTypeTableImpl {...props} generator={getGenerator()} />
    </div>
  );
}
