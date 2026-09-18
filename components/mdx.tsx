import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Files, Folder } from 'fumadocs-ui/components/files';
import type { MDXComponents } from 'mdx/types';
import { AutoTypeTable } from '@/components/auto-type-table';
import { ComponentPreview } from '@/components/component-preview';
import { InstallCommand } from '@/components/install-command';
import { ManualInstall } from '@/components/manual-install';
import { KeymapTable } from '@/components/keymap-table';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    AutoTypeTable,
    ComponentPreview,
    InstallCommand,
    ManualInstall,
    KeymapTable,
    Step,
    Steps,
    File,
    Files,
    Folder,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
