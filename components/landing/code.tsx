import { highlight } from "fumadocs-core/highlight";
import { CODE_THEMES } from "@/lib/code-themes";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

export async function Code({ code, label }: { code: string; label: string }) {
  return highlight(code, {
    lang: "tsx",
    themes: CODE_THEMES,
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
