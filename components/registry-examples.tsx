import dynamic from "next/dynamic";
import type { ComponentType } from "react";

/**
 * Static import map for every `registry:example` item — dynamic() needs statically analyzable
 * paths (a computed `import(name)` isn't bundleable), so each entry is spelled out.
 * No "use client" here: next/dynamic is called from the server component ComponentPreview,
 * which is fine — each target module is already "use client", and dynamic() returns a component
 * reference, not a function ComponentPreview calls.
 */
const EXAMPLES = {
  "data-grid-minimal-demo": dynamic(() => import("@/registry/default/examples/data-grid-minimal-demo")),
  "data-grid-streaming-demo": dynamic(() => import("@/registry/default/examples/data-grid-streaming-demo")),
  "data-grid-demo": dynamic(() => import("@/registry/default/examples/data-grid-demo")),
  "data-grid-cell-types-demo": dynamic(() => import("@/registry/default/examples/data-grid-cell-types-demo")),
  "data-grid-sorting-filtering-demo": dynamic(() => import("@/registry/default/examples/data-grid-sorting-filtering-demo")),
  "data-grid-history-demo": dynamic(() => import("@/registry/default/examples/data-grid-history-demo")),
  "data-grid-context-menu-demo": dynamic(() => import("@/registry/default/examples/data-grid-context-menu-demo")),
  "data-grid-keybindings-demo": dynamic(() => import("@/registry/default/examples/data-grid-keybindings-demo")),
  "data-grid-io-demo": dynamic(() => import("@/registry/default/examples/data-grid-io-demo")),
  "data-grid-url-state-demo": dynamic(() => import("@/registry/default/examples/data-grid-url-state-demo")),
  "data-grid-row-markers-demo": dynamic(() => import("@/registry/default/examples/data-grid-row-markers-demo")),
  "data-grid-custom-headers-demo": dynamic(() => import("@/registry/default/examples/data-grid-custom-headers-demo")),
  "data-grid-custom-markers-demo": dynamic(() => import("@/registry/default/examples/data-grid-custom-markers-demo")),
  "data-grid-pinning-demo": dynamic(() => import("@/registry/default/examples/data-grid-pinning-demo")),
  "data-grid-large-data-demo": dynamic(() => import("@/registry/default/examples/data-grid-large-data-demo")),
  "data-grid-performance-demo": dynamic(() => import("@/registry/default/examples/data-grid-performance-demo")),
  "data-grid-pinned-rows-demo": dynamic(() => import("@/registry/default/examples/data-grid-pinned-rows-demo")),
  "data-grid-conditional-styling-demo": dynamic(() => import("@/registry/default/examples/data-grid-conditional-styling-demo")),
  "data-grid-styling-patterns-demo": dynamic(() => import("@/registry/default/examples/data-grid-styling-patterns-demo")),
  "data-grid-lazy-demo": dynamic(() => import("@/registry/default/examples/data-grid-lazy-demo")),
  "data-grid-pagination-demo": dynamic(() => import("@/registry/default/examples/data-grid-pagination-demo")),
  "data-grid-sort-list-demo": dynamic(() => import("@/registry/default/examples/data-grid-sort-list-demo")),
  "data-grid-presence-demo": dynamic(() => import("@/registry/default/examples/data-grid-presence-demo")),
  "data-grid-events-demo": dynamic(() => import("@/registry/default/examples/data-grid-events-demo")),
  "data-grid-custom-cell-demo": dynamic(() => import("@/registry/default/examples/data-grid-custom-cell-demo")),
  "data-grid-validation-demo": dynamic(() => import("@/registry/default/examples/data-grid-validation-demo")),
  "data-grid-cell-errors-demo": dynamic(() => import("@/registry/default/examples/data-grid-cell-errors-demo")),
  "data-grid-i18n-demo": dynamic(() => import("@/registry/default/examples/data-grid-i18n-demo")),
  "data-grid-fill-patterns-demo": dynamic(() => import("@/registry/default/examples/data-grid-fill-patterns-demo")),
  "data-grid-loading-demo": dynamic(() => import("@/registry/default/examples/data-grid-loading-demo")),
  "data-grid-playground-demo": dynamic(() => import("@/registry/default/examples/data-grid-playground-demo")),
} satisfies Record<string, ComponentType>;

export type RegistryExampleName = keyof typeof EXAMPLES;

export function getRegistryExample(name: RegistryExampleName): ComponentType {
  return EXAMPLES[name];
}
