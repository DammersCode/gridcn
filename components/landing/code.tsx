import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

export async function Code({ code, label }: { code: string; label: string }) {
  return highlight(code, {
    lang: "tsx",
    themes: { light: "github-light-high-contrast", dark: "github-dark" },
    defaultColor: false,
    components: {
      pre: (props) => (
        <CodeBlock {...props} viewportProps={{ "aria-label": label }} className="my-0 min-w-0">
          <Pre>{props.children}</Pre>
        </CodeBlock>
      ),
    },
  });
}
