import { AutoTypeTable as AutoTypeTableImpl } from "fumadocs-typescript/ui";
import { getTypeGenerator } from "@/lib/type-generator";

/** Server-component-only: generates a prop table from a real TS type at build time (see AutoTypeTableImpl). */
export function AutoTypeTable(props: Record<string, unknown>) {
  return (
    <div className="auto-type-table">
      <AutoTypeTableImpl {...props} generator={getTypeGenerator()} />
    </div>
  );
}
