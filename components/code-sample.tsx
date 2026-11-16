'use client';

import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement } from 'react';

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
