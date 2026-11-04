# CLAUDE.md

Static site (Astro 7 + Svelte 5 islands, TypeScript) visualising OpenUSD / MaterialX support across film, VFX,
games and adjacent industries. Deployed to GitHub Pages at base path `/USD-Mtlx-Support-Graph`.

## Commands

- `npm run validate` / `npm run review`: data checks (`scripts/validate-data.ts`). Run after every data edit.
- `npm run check`: `astro check` type check.
- `npm run build`: static build to `dist/`. CI (`.github/workflows/site.yml`) runs review → check → build → deploy.

## Layout

- `data/`: all content as YAML. `capabilities.yaml` (taxonomy, file order = display order), `products/<id>.yaml`.
- `src/data/schema.ts`: Zod schemas shared by Astro collections and the validator. Change the schema there only.
- `src/data/yaml.ts`: YAML parsing with the same options as Astro's loader. Use it for any script reading `data/`.
- `src/content.config.ts`: collections. `src/lib/data.ts` → `loadData()` for pages and endpoints.
- `src/lib/url.ts`: `withBase()`. Every internal link and asset URL must go through it (Pages base path).
- `src/styles/global.css`: design tokens (light + dark via `prefers-color-scheme` and `[data-theme]`).

## Data rules (do not relax)

- Every support record, release and event needs ≥1 source with `accessed` date, plus `confidence` and `verified`.
- No claims from memory: research against live official sources, preferring docs and release notes over forums.
- Uncertain or conflicting records get `review: "<why>"`. The user reviews only flagged and low-confidence records.
- Absence of a record = unknown. Never add a record just to say "unknown".
- Version strings are quoted. Product ids are kebab-case and match the file name.
- Scope includes adjacent industries: AEC, product design/CAD, automotive, simulation, XR/web.

## Toolchain notes

- TypeScript is pinned to ^6 because `@astrojs/check` does not support TS 7 yet.
- npm 11 skips esbuild's postinstall script (allowScripts). Builds work without it.
