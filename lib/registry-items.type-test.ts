/**
 * Compile-time check for RegistryItemName: real item names (core, add-on, demo) must stay
 * assignable, and a name that does not exist in registry.json must not. tsc gate typechecks
 * this file; vitest's *.type-test.ts glob excludes it, matching the repo's other type tests.
 */
import type { RegistryItemName } from "./registry-items";

const core: RegistryItemName = "data-grid";
const addon: RegistryItemName = "data-grid-toolbar";
const demo: RegistryItemName = "data-grid-row-reorder-demo";

// @ts-expect-error — a name that does not exist in registry.json must not be assignable
const unknown: RegistryItemName = "data-grid-does-not-exist";

void core;
void addon;
void demo;
void unknown;

export {};
