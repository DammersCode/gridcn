import tseslint from "typescript-eslint";

// Type-checked lint gate (the slow half of `pnpm lint:typed`). Everything else — the fast
// whole-repo gate — runs on oxlint (`.oxlintrc.json` + `pnpm lint`). Only the type-aware
// no-unsafe-* rules live here, because they need TypeScript's type information, which a
// parser-only linter cannot see. Scope: registry SOURCE (not tests — vitest/testing-library
// typings return `any` by design), mirroring the old eslint.config.mjs invariant.
export default tseslint.config(
  {
    ignores: [
      "**/worktrees/**",
      "node_modules/**",
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "public/**",
      ".source/**",
      "references/**",
      "*.tsbuildinfo",
    ],
  },
  {
    // Non-type-aware leftovers of the old config that source-code disable comments reference
    // (the deliberate `any` TValidate-erasure boundaries, the vendored namespace merge).
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-namespace": "warn",
    },
  },
  {
    files: ["registry/**/*.ts", "registry/**/*.tsx"],
    ignores: ["registry/**/*.test.ts", "registry/**/*.test.tsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
    },
  },
  {
    // An un-awaited render/unmount in a browser test overlaps React act() scopes and breaks every later test in the file.
    files: ["registry/**/*.browser.test.tsx"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
