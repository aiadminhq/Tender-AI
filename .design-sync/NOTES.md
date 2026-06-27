# design-sync notes — Tender AI Design System

> Persisted corrections & caveats for re-syncs. Read before changing `config.json`.
> Claude Design project: `bcb28899-30d2-47b1-ae7a-d7aa4af2cfeb` ("Tender AI Design System").

## Target shape

- `tender-ai-frontend/` is a Vite **application** (React 19 + TS + Tailwind CSS 4, pnpm),
  not a published library — no Storybook, no usable `dist/`. Shape = `package`
  ("synth-entry from src" territory).

## Why the generated barrel + `entry`

Pure synth-entry fails here: with no `--entry` the converter sets
`PKG_DIR = node_modules/<pkg>`, but the app is **not** self-installed in its own
`node_modules`, so that dir doesn't exist. We can't repurpose `--node-modules`
(esbuild's `nodePaths` needs the _real_ `tender-ai-frontend/node_modules` to
resolve react / @radix-ui / cva).

Fix: a committed barrel **`tender-ai-frontend/.design-sync-entry.tsx`** that
re-exports every `src/components/ui/*` component. `config.entry` points at it
(cwd-relative). The converter walks up from the entry to the nearest
`package.json` with a name → `PKG_DIR = tender-ai-frontend` ✓. Because an entry
is set, `synthEntry=false`, so the **card list comes entirely from
`componentSrcMap`** — every logical component is enumerated there. The bundle
still exports all barrel exports (so designs can compose CardHeader, ChartTooltip…).

- `ButtonVariants` is a CVA helper in `button-variants.ts`, not a component →
  `componentSrcMap: { "ButtonVariants": null }` (also auto-excluded, `.ts` not `.tsx`).
- Path alias `@/* → ./src/*` lives in `tsconfig.app.json` → `config.tsconfig`
  points there so esbuild resolves `@/` imports.

## Theme — default **light** via `[data-theme]`

App theme switches on the **HTML `[data-theme]` attribute, default LIGHT** — see
`index.html` pre-paint (`if (t !== "light" && t !== "dark") t = "light"`) and
`src/lib/storage.ts` `loadTheme()` (non-`dark` → `light`). The CSS-variable tokens
resolve off the `[data-theme]` ancestor; `:root` carries the dark primitives and
`[data-theme="light"]` overrides them, but the running app **always** sets the
attribute and defaults it to light. So the barrel exports a **`ThemeProvider`** that
wraps children in `<div data-theme="light">` (with `--canvas`/`--ink` surface), and
`config.provider = { component: "ThemeProvider" }` wraps every preview/floor card —
matching what users actually see.

> Correction (2026-06-27): an earlier run wrongly recorded "default dark" and
> shipped dark previews. The app has always defaulted light; ThemeProvider +
> conventions.md were flipped to light to match. Owner directive: 永遠預設淺色。

## Tailwind CSS 4 — CSS heal is REQUIRED (already applied)

`src/index.css` is `@import "tailwindcss"` + `@import "tw-animate-css"` (Tailwind 4,
build-time utilities). Pointing `cssEntry` at it raw fails validate with
`[CSS_IMPORT_MISSING]` (the `@import`s don't resolve at runtime). Confirmed.

**Fix (committed path):** compile to a full static CSS, bounded under PKG_DIR, and
point `cssEntry` there:

```sh
cd tender-ai-frontend
npx -y @tailwindcss/cli@4.3.1 -i src/index.css -o .design-sync-tw.css --minify
```

- Output `tender-ai-frontend/.design-sync-tw.css` (~84 KB) is **gitignored**
  (regenerable). `config.cssEntry = ".design-sync-tw.css"`.
- Pin the CLI version to the installed `tailwindcss` (4.3.1). `npm install` into this
  pnpm tree breaks (`Cannot read properties of null`) — use `npx`, don't add the CLI
  as a dep.
- The compiled CSS inlines `tw-animate-css`, keeps `:root`/`[data-theme=dark]`
  (dark primitives) + `[data-theme=light]` (overrides) token blocks. Components flip
  theme via CSS vars, not the `dark:` variant (0 `dark:` utilities). `:root` alone is
  dark, so `ThemeProvider` **must** set `[data-theme="light"]` explicitly to render
  previews in the app's real (light) default — which it now does.
- **Recompile after authoring previews** if they add utility classes not already in
  `src/` (Tailwind only scans what it sees) — then rebuild.

`SF Pro Text` / `SF Mono` are macOS system fonts used in CSS fallback stacks; added to
`runtimeFontPrefixes` so `[FONT_MISSING]` doesn't flag them (they substitute on canvas).

## Fonts — runtime-loaded, not bundled

Inter / Noto Sans TC / JetBrains Mono load at runtime via `index.html` Google
Fonts `<link>`. `config.runtimeFontPrefixes` whitelists them so
`[FONT_REMOTE]`/`[FONT_MISSING]` don't block validate. House rule: **CJK is never
serif**; keep font sizes converged.

## Components

- **Core 11 (authored previews):** Avatar, Badge, Button, Card, Dialog,
  FeasibilityMeter, Input, MaximizableCard, Separator, Sheet, TierBadge.
- **Rest (floor card, first run):** Alert, CategoryBadge, Select, Switch, Tabs,
  TrendBadge, BarSpark, LineSpark, ChartContainer. Expand to authored later.
- Sub-exports (CardHeader, ChartTooltip, CategoryIcon, StreakDots, …) stay in the
  bundle for composition but aren't carded.

## Provider chaining — AppProvider inside ThemeProvider

`MaximizableCard` consumes `useApp()` (`t`, `lang`) from `AppProvider`. So the
provider is **chained**: `config.provider = { component: "ThemeProvider", inner:
{ component: "AppProvider" } }` → every preview/floor card is wrapped
`<ThemeProvider><AppProvider>…`. Without the inner provider MaximizableCard throws
on render. The barrel exports both.

## Single-mode overlays — `min-height:100vh` wrapper in the preview (Dialog, Sheet)

`Dialog` and `Sheet` are `cardMode: "single"` (full-bleed single-card render, no
grid) at `viewport: "560x760"`, because their outermost node is `fixed inset-0`.
**Gotcha:** the single-mode wrapper `.ds-single` carries `transform:translateZ(0)`,
which makes it the containing block for `position:fixed` descendants — a zero-height
containing block clips the overlay at the top. **Fix (lives in the preview file, so
it survives re-sync):** wrap the overlay export in an in-flow
`<div style={{ minHeight: "100vh" }}>`. Applied to both `Dialog.tsx` (AcceptQuestionnaire)
and `Sheet.tsx` (TenderDetail); both raw screenshots confirmed correct.

## Card column-mode

`config.overrides.Card = { cardMode: "column" }` → the Card preview renders one cell
per full-width row (vs the default multi-column grid), so wide tender-card layouts
aren't squeezed into grid columns.

## conventions header → README (cfg.readmeHeader)

`.design-sync/conventions.md` is prepended **verbatim** to the generated `README.md`
(which reaches the design agent). `config.readmeHeader = ".design-sync/conventions.md"`
— **path is relative to the config HOME** (the dir containing `.design-sync/`, i.e. repo
root "Tender AI"), NOT relative to `.design-sync/`. A bare `conventions.md` resolves to
`<repo>/conventions.md` and warn-skips. Consumer inlines only the first 32,000 README
chars; keep the header concise.

## Build / validate commands (run from repo root "Tender AI")

```sh
node .ds-sync/package-build.mjs \
  --config .design-sync/config.json \
  --node-modules tender-ai-frontend/node_modules \
  --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle
```

(`entry`, `tsconfig`, `cssEntry`, `componentSrcMap` come from config; `entry` and
`--node-modules`/`--out` are cwd-relative, other config paths are PKG_DIR-relative.)
Converter deps (esbuild, ts-morph, @types/react) install into `.ds-sync/`.
