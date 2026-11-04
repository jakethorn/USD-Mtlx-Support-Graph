# CLAUDE.md

Static site (Astro 7 + Svelte 5 islands, TypeScript) visualising OpenUSD / MaterialX support across film, VFX,
games and adjacent industries. Deployed to GitHub Pages at base path `/USD-Mtlx-Support-Graph`.

## Commands

- `npm run validate` / `npm run review`: data checks (`scripts/validate-data.ts`). Run after every data edit.
- `npm run check`: `astro check` type check.
- `npm run build`: static build to `dist/`. CI (`.github/workflows/site.yml`) runs review → check → build → deploy.
- `npm run ingest` (or `ingest:materialx|usd|releases|github`): Python stdlib scripts in `scripts/ingest/` that write
  `data/generated/*.json`. Locally: `GITHUB_TOKEN="$("/c/Program Files/GitHub CLI/gh.exe" auth token)" npm run ingest`.
  Output is deterministic, so an unchanged upstream gives no diff. `refresh-data.yml` runs it weekly and commits.
- `gh` isn't on the Bash PATH. Use `"/c/Program Files/GitHub CLI/gh.exe"`.

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

## Researching products

- Follow `docs/research-guide.md` (levels, sources, review flags). Tier 1 (19 products) was researched on 2026-11-04
  by parallel agents grouped by vendor, then each file was independently fact-checked against every cited source.
  Repeat that two-step pattern (research, then verify) for Tier 2.
- Verification agents work fine on Sonnet. Running six research agents on Opus at once hit the user's 5-hour usage
  limit, so stagger agents or use smaller groups.
- `npm run check:links` checks every source URL (0 broken at last run). Sites that block bots: unrealengine.com,
  issues.unrealengine.com, autodesk.com product pages, support.maxon.net, projects.blender.org pages (its API and
  raw files work). Appending `.md` gives clean text on help.maxon.net, documentation.chaos.com and
  rmanwiki-27.pixar.com.
- `/products/<id>/` and `/review/` are plain interim pages for reading the data. The designed views come in Phase 4.

## Ingestion quirks (scripts/ingest)

- Upstream repos are blobless sparse clones in `.cache/repos/` (gitignored). Each tag is checked out with only the
  parsed files. Don't `git grep` across tags in them: that lazily fetches every blob.
- MaterialX: library XML is parsed raw (no version upgrade). `lenient_xml()` escapes the bare `&`/`<` in attribute
  values that pugixml tolerates. Target resolution mirrors `NodeDef::getImplementation` (target-specific with
  inheritance first, then untargeted node graph). `genoslnetwork` is excluded: its impls are generated at build time.
  This is coverage of MaterialX's *own* generators, not of renderers.
- USD: properties come from `generatedSchema.usda` (flattened). Parent type, doc and own-vs-inherited come from the
  hand-written `schema.usda`. Class bodies open with `{` or `) {`. Doc strings contain code samples, so the
  parser tracks triple-quote state. Versioned schemas (`Capsule_1`) get `versionOf`.
- Python scripts force UTF-8 stdout (Windows cp1252 crashes on the log arrows).

## Toolchain notes

- TypeScript is pinned to ^6 because `@astrojs/check` does not support TS 7 yet.
- npm 11 skips esbuild's postinstall script (allowScripts). Builds work without it.
