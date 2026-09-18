import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

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
      include: ["registry/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.browser.test.{ts,tsx}",
        "**/*.type-test.ts",
        "**/*.tsx",
        "registry/**/index.ts",
        "registry/**/*-index.ts",
      ],
      // PLAN §10/11 testing bar: pure lib modules (selection math, clipboard parse/serialize,
      // fill/series, sort-filter, history, keymap matching, url-state serializers, etc.) hold a
      // ~95-100% branch bar with an enforced CI gate. React glue (hooks, store, context,
      // components) is explicitly NOT line-coverage-chased here — see PLAN §10.
      thresholds: {
        // no global floor: hooks/components/examples are intentionally excluded from this gate.
        branches: 0,
        perFile: true,
        "registry/default/blocks/data-grid/cell-types/cell-types.ts": { branches: 90 },
        "registry/default/blocks/data-grid/clipboard/clipboard.ts": { branches: 90 },
        "registry/default/blocks/data-grid/columns/column-helpers.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/compact-selection.ts": { branches: 90 },
        "registry/default/blocks/data-grid/fill/compute-fill-target.ts": { branches: 90 },
        "registry/default/blocks/data-grid/sort-filter/default-compare-text.ts": { branches: 90 },
        "registry/default/blocks/data-grid/keyboard/default-keymap.ts": { branches: 90 },
        "registry/default/blocks/data-grid/rows/density.ts": { branches: 90 },
        "registry/default/blocks/data-grid/fill/detect-series.ts": { branches: 90 },
        "registry/default/blocks/data-grid/cell-types/display-text.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/empty-selection.ts": { branches: 90 },
        "registry/default/blocks/data-grid/columns/encode-template.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/extend-to.ts": { branches: 90 },
        "registry/default/blocks/data-grid/fill/fill-direction.ts": { branches: 90 },
        "registry/default/blocks/data-grid/fill/fill.ts": { branches: 90 },
        "registry/default/blocks/data-grid/sort-filter/find-search-matches.ts": { branches: 90 },
        "registry/default/blocks/data-grid/fill/generate-fill.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/grow-selection.ts": { branches: 90 },
        "registry/default/blocks/data-grid/interaction/history.ts": { branches: 90 },
        "registry/default/blocks/data-grid/keyboard/is-printable-key.ts": { branches: 90 },
        "registry/default/blocks/data-grid/keyboard/keymap.ts": { branches: 90 },
        "registry/default/blocks/data-grid/labels.ts": { branches: 90 },
        "registry/default/blocks/data-grid/rows/marker-width.ts": { branches: 90 },
        "registry/default/blocks/data-grid/keyboard/match-keymap.ts": { branches: 90 },
        "registry/default/blocks/data-grid/sort-filter/matches-filter.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/offset-selection-for-rows.ts": { branches: 90 },
        // merged from parse-clipboard-html.ts (85) + parse-clipboard-text.ts (90) + parse-clipboard.ts (90) - kept at the lower bound so the merge itself isn't a gate regression
        "registry/default/blocks/data-grid/clipboard/parse-clipboard.ts": { branches: 85 },
        // merged from pin-left-offsets.ts + pin-right-offsets.ts (both 90)
        "registry/default/blocks/data-grid/columns/pin-offsets.ts": { branches: 90 },
        "registry/default/blocks/data-grid/columns/pinned-inset-style.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/push-range.ts": { branches: 90 },
        "registry/default/blocks/data-grid/columns/resolve-column-width.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/select-all-progression.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/select-cell.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/select-column.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/select-line-options.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/select-row.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/selection-contains-cell.ts": { branches: 85 },
        "registry/default/blocks/data-grid/selection/selection-rects.ts": { branches: 90 },
        // merged from combine-rects/intersect-rect/point-in-rect/rect-contains/rect-from-corners/rect-relative-to.ts (all 90)
        "registry/default/blocks/data-grid/selection/rects.ts": { branches: 90 },
        "registry/default/blocks/data-grid/selection/selection.ts": { branches: 90 },
        "registry/default/blocks/data-grid/clipboard/serialize-cells.ts": { branches: 90 },
        "registry/default/blocks/data-grid/sort-filter/sort-filter.ts": { branches: 90 },
        "registry/default/blocks/data-grid-context-menu/autosize-column.ts": { branches: 85 },
        "registry/default/blocks/data-grid-context-menu/format-keymap-shortcut.ts": { branches: 90 },
        "registry/default/blocks/data-grid-context-menu/is-cell-in-selection.ts": { branches: 90 },
        "registry/default/blocks/data-grid-context-menu/resolve-context-menu-target.ts": { branches: 90 },
        "registry/default/blocks/data-grid-context-menu/selected-view-rows.ts": { branches: 90 },
        "registry/default/blocks/data-grid-io/build-imported-rows.ts": { branches: 85 },
        "registry/default/blocks/data-grid-io/export-grid.ts": { branches: 90 },
        "registry/default/blocks/data-grid-io/match-import-column.ts": { branches: 90 },
        "registry/default/blocks/data-grid-io/parse-import-file.ts": { branches: 90 },
        "registry/default/blocks/data-grid-keybindings/action-groups.ts": { branches: 90 },
        "registry/default/blocks/data-grid-keybindings/action-labels.ts": { branches: 90 },
        "registry/default/blocks/data-grid-toolbar/operators-for-column-type.ts": { branches: 90 },
        "registry/default/blocks/data-grid-url-state/filter-operators.ts": { branches: 90 },
        "registry/default/blocks/data-grid-url-state/prefixed-key.ts": { branches: 90 },
        // merged from serialize-sort-state.ts + parse-sort-state.ts (both 90)
        "registry/default/blocks/data-grid-url-state/sort-param.ts": { branches: 90 },
        // merged from serialize-filter-state.ts + parse-filter-state.ts (both 90)
        "registry/default/blocks/data-grid-url-state/filter-param.ts": { branches: 90 },
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
