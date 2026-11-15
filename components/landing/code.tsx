import { highlight } from "fumadocs-core/highlight";

export async function Code({ code, label }: { code: string; label: string }) {
  return highlight(code, {
    lang: "tsx",
    themes: { light: "light-plus", dark: "github-dark" },
    components: {
      pre: (props) => (
        <pre
          {...props}
          tabIndex={0}
          aria-label={label}
          className="min-w-0 overflow-x-auto border p-4 text-start font-mono text-xs leading-relaxed dark:!bg-background dark:[&_span]:!text-[var(--shiki-dark)]"
        />
      ),
    },
  });
}
