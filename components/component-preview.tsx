import type { ReactNode } from "react";
import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { getRegistryExample, type RegistryExampleName } from "@/components/registry-examples";
import { PreviewTabs } from "@/components/preview-tabs";
import { readExampleSource } from "@/lib/read-example-source";

type ComponentPreviewProps = {
  /** registry:example item name, e.g. "data-grid-demo" — resolved via the static import map in registry-examples.tsx. */
  name: RegistryExampleName;
  /** Preview area alignment; most demos are `h-[...]` fixed-height so 'start' avoids extra centering whitespace. */
  align?: "start" | "center";
};

/**
 * Preview/Code tabs for a registry:example — the exact code the consumer would get from
 * `npx shadcn add @gridcn/<item>`. Source resolution + highlighting happen server-side here;
 * the diceui-style tab shell is the client component {@link PreviewTabs}.
 */
export async function ComponentPreview({ name, align = "start" }: ComponentPreviewProps): Promise<ReactNode> {
  const Example = getRegistryExample(name);
  const source = readExampleSource(name);
  // CodeBlock (not bare Pre) supplies the scroll viewport, padding, and copy button.
  const highlighted = await highlight(source, {
    lang: "tsx",
    components: {
      pre: (props) => (
        <CodeBlock {...props}>
          <Pre>{props.children}</Pre>
        </CodeBlock>
      ),
    },
  });

  return <PreviewTabs preview={<Example />} code={highlighted} align={align} />;
}
