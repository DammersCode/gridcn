# Paper-style docs theme (workplan #5)

## Approach

Single-file token overlay in `app/global.css`, layered on top of the existing shadcn `:root`/`.dark`
blocks (no new files, no new deps). Three changes:

1. **Warmed neutrals** — every shadcn color token (`--background`, `--card`, `--popover`,
   `--secondary`, `--muted`, `--accent`, `--border`, `--sidebar*`) moved from achromatic
   `oklch(x 0 0)` to a low-chroma warm hue (~50-70°, paper/cream), both themes. Chroma stays
   tiny (0.004–0.02) so it reads as warm tone, not a colored theme — avoids the generic
   cream-serif AI-design cliché the brief explicitly steers away from.
2. **Bigger radius scale** — `--radius` 0.625rem → 1rem. Every `rounded-sm/md/lg/xl/2xl/3xl/4xl`
   utility already derives from this one variable via the existing `@theme inline` multipliers,
   so the whole app (cards, code blocks, buttons, dialogs, sidebar pills) got rounder for free.
3. **Fumadocs color bridge (the actual fix)** — `app/global.css` only imported
   `fumadocs-ui/css/neutral.css`, which hardcodes its own achromatic `--color-fd-*` HSL palette
   completely decoupled from the shadcn tokens above. Docs chrome (sidebar, TOC, search dialog,
   cards, callouts, code blocks — all styled with `bg-fd-*`/`text-fd-*`/`border-fd-*` classes)
   was invisible to any shadcn theming. Added an explicit `--color-fd-*: var(--shadcn-token)`
   bridge block (mirroring fumadocs' own unused `css/shadcn.css`) plus the `#nd-sidebar` override
   it needs, so the docs chrome now actually follows the paper theme in both modes.
4. **Soft paper shadows** — new `--shadow-paper-color` (warm-tinted, higher alpha in dark) feeds
   Tailwind's `--tw-shadow-color` custom property at `:root`/`.dark`, so existing `shadow-sm/md`
   utilities (cards, callouts, code blocks, the diceui preview tabs) get a warm low-elevation
   "paper on a desk" shadow instead of flat black-alpha, with no class changes anywhere.

## Token table

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `--background` | `oklch(0.98 0.006 70)` | `oklch(0.19 0.008 55)` | page canvas |
| `--card` / `--popover` | `oklch(0.995 0.004 70)` | `oklch(0.23 0.009 55)` | cards, callouts, code blocks, dialogs |
| `--secondary` / `--muted` | `oklch(0.955 0.008 65)` | `oklch(0.28 0.01 55)` | tab bars, kbd chips, subtle fills |
| `--accent` | `oklch(0.94 0.012 60)` | `oklch(0.32 0.012 55)` | hovers, active sidebar item |
| `--border` / `--input` | `oklch(0.9 0.01 60)` | `oklch(1 0.006 65 / 10%)` | hairlines |
| `--foreground` | `oklch(0.24 0.012 55)` | `oklch(0.94 0.006 65)` | body text |
| `--sidebar` | `oklch(0.97 0.008 65)` | `oklch(0.21 0.009 55)` | sidebar panel |
| `--radius` | `1rem` | `1rem` | base of the whole radius scale (was 0.625rem) |
| `--shadow-paper-color` | `45 20% 30%` (hsl) | `30 30% 4%` (hsl) | tint for `--tw-shadow-color` |
| `--tw-shadow-color` | `hsl(var(--shadow-paper-color) / 0.1)` | `hsl(var(--shadow-paper-color) / 0.35)` | retints all `shadow-sm/md/lg` utilities warm |

`--color-fd-*` (all of them) now alias the matching shadcn token above instead of `neutral.css`'s
fixed grays — this is what makes the docs chrome follow the theme at all.

## Surfaces covered

- Docs sidebar + active-item pill, TOC, breadcrumb bar — via the `--color-fd-*` bridge + `#nd-sidebar`.
- Command/search dialog (`Ctrl+K`) — warm popover surface, soft shadow, rounded corners.
- Cards (`fumadocs-ui/components/card`) and callouts — warm `bg-fd-card`, bigger `rounded-xl`, soft `shadow-md`.
- Code blocks (`CodeBlock`/`Pre`) and the diceui-style `PreviewTabs` panel — warm card/secondary
  surfaces, rounded-xl container, soft shadow-sm.
- Home page hero, feature cards, add-on grid — inherit `bg-card`/`border-border`/`shadow-sm` directly, no changes needed.
- The grid itself (`DataGridDemo` embedded on the home page) — untouched; it renders inside its
  own bordered `rounded-xl` frame using plain `border-border`/table cell tokens, stays visually
  crisp/neutral as required.

## Verification

Screenshotted `/docs/quick-start`, `/docs`, and `/` in both themes via agent-browser (dev server,
port 3000) plus the `Ctrl+K` search dialog — warm paper tone and soft shadows are consistent and
legible in both light and dark, and the embedded grid demo stays visually distinct/neutral from
the surrounding chrome.
