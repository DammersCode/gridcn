import { existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import picomatch from "picomatch";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

// per-file branch bars for the pure-lib modules; keys are repo-root-relative file paths.
// Validated at load: a key outside the coverage include, inside an exclude, or naming no file enforces nothing.
const perFileBranchThresholds: Record<string, { branches: number }> = {
  "registry/default/blocks/data-grid/cell-types/cell-types.ts": { branches: 90 },
  "registry/default/blocks/data-grid/columns/column-helpers.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/compact-selection.ts": { branches: 90 },
  "registry/default/blocks/data-grid/sort-filter/default-compare-text.ts": { branches: 90 },
  "registry/default/blocks/data-grid/keyboard/default-keymap.ts": { branches: 90 },
  "registry/default/blocks/data-grid/rows/density.ts": { branches: 90 },
  "registry/default/blocks/data-grid/cell-types/display-text.ts": { branches: 90 },
  "registry/default/blocks/data-grid/sort-filter/find-search-matches.ts": { branches: 90 },
  "registry/default/blocks/data-grid/interaction/history.ts": { branches: 90 },
  "registry/default/blocks/data-grid/keyboard/is-printable-key.ts": { branches: 90 },
  "registry/default/blocks/data-grid/labels.ts": { branches: 90 },
  "registry/default/blocks/data-grid/rows/marker-width.ts": { branches: 90 },
  "registry/default/blocks/data-grid/keyboard/global-shortcuts.ts": { branches: 90 },
  "registry/default/blocks/data-grid/keyboard/match-keymap.ts": { branches: 90 },
  "registry/default/blocks/data-grid/sort-filter/matches-filter.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/offset-selection-for-rows.ts": { branches: 90 },
  "registry/default/blocks/data-grid/clipboard/parse-clipboard.ts": { branches: 90 },
  "registry/default/blocks/data-grid/columns/pin-offsets.ts": { branches: 90 },
  "registry/default/blocks/data-grid/columns/pinned-inset-style.ts": { branches: 90 },
  "registry/default/blocks/data-grid/columns/resolve-column-width.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/select-all-progression.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/select-line-options.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/rects.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/selection-ops.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/line-ops.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/extend-selection.ts": { branches: 90 },
  "registry/default/blocks/data-grid/columns/column-format-helpers.ts": { branches: 90 },
  "registry/default/blocks/data-grid/keyboard/key-syntax.ts": { branches: 90 },
  "registry/default/blocks/data-grid/clipboard/serialize-cells.ts": { branches: 90 },
  "registry/default/blocks/data-grid/sort-filter/build-view-index.ts": { branches: 90 },
  "registry/default/blocks/data-grid/sort-filter/incremental-view-index.ts": { branches: 90 },
  "registry/default/blocks/data-grid/selection/selected-view-rows.ts": { branches: 90 },
  "registry/default/blocks/data-grid-fill/compute-fill-target.ts": { branches: 90 },
  "registry/default/blocks/data-grid-fill/detect-series.ts": { branches: 90 },
  "registry/default/blocks/data-grid-fill/fill-direction.ts": { branches: 90 },
  "registry/default/blocks/data-grid-fill/generate-fill.ts": { branches: 90 },
  "registry/default/blocks/data-grid-context-menu/autosize-column.ts": { branches: 90 },
  "registry/default/blocks/data-grid-context-menu/selection-queries.ts": { branches: 90 },
  "registry/default/blocks/data-grid-context-menu/resolve-context-menu-target.ts": { branches: 90 },
  "registry/default/blocks/data-grid-io/build-imported-rows.ts": { branches: 90 },
  "registry/default/blocks/data-grid-io/export-grid.ts": { branches: 90 },
  "registry/default/blocks/data-grid-io/match-import-column.ts": { branches: 90 },
  "registry/default/blocks/data-grid-io/parse-import-file.ts": { branches: 90 },
  "registry/default/blocks/data-grid-keybindings/action-groups.ts": { branches: 90 },
  "registry/default/blocks/data-grid-keybindings/action-labels.ts": { branches: 90 },
  "registry/default/blocks/data-grid-toolbar/operators-for-column-type.ts": { branches: 90 },
  "registry/default/blocks/data-grid-url-state/filter-operators.ts": { branches: 90 },
  "registry/default/blocks/data-grid-url-state/prefixed-key.ts": { branches: 90 },
  "registry/default/blocks/data-grid-url-state/sort-param.ts": { branches: 90 },
  "registry/default/blocks/data-grid-url-state/filter-param.ts": { branches: 90 },
};

const coverageInclude = ["registry/**/*.ts"];
const isCoverageIncluded = picomatch(coverageInclude);
// Files coverage never measures: a threshold key inside these globs would silently enforce nothing.
const coverageExclude = [
  "**/*.test.{ts,tsx}",
  "**/*.browser.test.{ts,tsx}",
  "**/*.type-test.ts",
  "**/*.tsx",
  "registry/**/index.ts",
];
const isCoverageExcluded = picomatch(coverageExclude);

for (const key of Object.keys(perFileBranchThresholds)) {
  if (key.startsWith("./") || key !== posix.normalize(key)) throw new Error(`coverage perFile threshold key is not a normalized repo-relative path: ${key}`);
  if (!isCoverageIncluded(key)) throw new Error(`coverage perFile threshold key matches no coverage include glob: ${key}`);
  if (isCoverageExcluded(key)) throw new Error(`coverage perFile threshold key matches a coverage exclude glob: ${key}`);
  if (!existsSync(join(root, key))) throw new Error(`coverage perFile threshold key matches no file: ${key}`);
}

// @vitejs/plugin-react 6 dropped its `babel` option and ignores it silently, so the compiler
// runs as a separate rolldown-babel pass. Scoped per-project: the default projects stay untransformed.
const reactCompiler = () => babel({ presets: [reactCompilerPreset({ target: "19" })] });

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": __dirname },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: coverageInclude,
      exclude: coverageExclude,
      // Pure lib modules hold a 90-100% branch bar per file; React glue is not coverage-chased.
      thresholds: {
        // no global floor: hooks/components/examples are intentionally excluded from this gate.
        branches: 0,
        perFile: true,
        ...perFileBranchThresholds,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["registry/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/*.browser.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
           name: "browser",
           // shared CI runners flake timing-dependent browser tests (poll/matcher timeouts, fps
           // ratios); a real failure fails all retries.
           retry: 2,
           include: ["registry/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            // vitest v5 auto-assigns a distinct port per browser project (strictPort off by
            // default bumps past any in-use/Windows-reserved port), so no explicit api port.
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
      // Opt-in mirrors of the two projects above, with the React Compiler wired in.
      // Not part of the default run: `pnpm test:compiler`.
      {
        extends: true,
        plugins: [reactCompiler()],
        test: {
          name: "unit-compiled",
          environment: "jsdom",
          include: ["registry/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/*.browser.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [reactCompiler()],
        test: {
           name: "browser-compiled",
           // shared CI runners flake timing-dependent browser tests (poll/matcher timeouts, fps
           // ratios); a real failure fails all retries.
           retry: 2,
           include: ["registry/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
