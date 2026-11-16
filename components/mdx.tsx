import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'fumadocs-ui/components/tabs';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement } from 'react';
import type { MDXComponents } from 'mdx/types';
import { DocsTab } from '@/components/docs-tab';
import { AutoTypeTable } from '@/components/auto-type-table';
import { ComponentPreview } from '@/components/component-preview';
import { InstallCommand } from '@/components/install-command';
import { ManualInstall } from '@/components/manual-install';
import { KeymapTable } from '@/components/keymap-table';
import { ParityCell, ParityLegend } from '@/components/parity-cell';
import { SkillInstall } from '@/components/skill-install';

type CodeSampleProps = ComponentProps<'pre'> & { title?: string; 'data-language'?: string };

/** Fence `pre` whose scroll region and copy button carry a name: the fence title, else the language. */
export function CodeSample({ title, children, ...props }: CodeSampleProps) {
  const language = props['data-language'];
  const sample = language ? `code sample, ${language}` : 'code sample';
  const label = title ?? `Code sample${language ? `, ${language}` : ''}`;
  return (
    <CodeBlock
      {...props}
      title={title}
      viewportProps={{ 'aria-label': label }}
      Actions={({ children: copy, ...actions }) => (
        <div {...actions}>
          {Children.map(copy, (node) => (isValidElement(node) ? cloneElement(node as ReactElement<{ 'aria-label'?: string }>, { 'aria-label': `Copy ${title ?? sample}` }) : node))}
        </div>
      )}
    >
      <Pre>{children}</Pre>
    </CodeBlock>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    pre: CodeSample,
    table: (props: ComponentProps<'table'>) => (
      <div tabIndex={0} className="relative overflow-auto prose-no-margin my-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <table {...props} />
      </div>
    ),
    AutoTypeTable,
    ComponentPreview,
    InstallCommand,
    ManualInstall,
    KeymapTable,
    SkillInstall,
    ParityCell,
    ParityLegend,
    Step,
    Steps,
    File,
    Files,
    Folder,
    Tabs,
    Tab: DocsTab,
    TabsList,
    TabsTrigger,
    TabsContent,
    Accordion,
    Accordions,
    ...components,
  } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
