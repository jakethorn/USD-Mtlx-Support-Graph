# CLAUDE.md

Static site (Astro 7 + Svelte 5 islands, TypeScript) visualising OpenUSD / MaterialX support across film, VFX,
games and adjacent industries. Deployed to GitHub Pages at base path `/USD-Mtlx-Support-Graph`.

## Commands

- `npm run validate` / `npm run review`: data checks (`scripts/validate-data.ts`). Run after every data edit.
- `npm run check`: `astro check` type check.
- `npm test`: unit tests in `tests/` (Node's built-in runner via tsx). They cover node-support resolution, URL state,
  feedback links and the version-lag helpers. CI runs them before the type check. Pure logic you add to `src/lib` or
  `src/data` should get a test here.
- `npm run build`: static build to `dist/`. CI (`.github/workflows/site.yml`) runs review → check → build → deploy.
- `npm run ingest` (or `ingest:materialx|usd|releases|github`): Python stdlib scripts in `scripts/ingest/` that write
  `data/generated/*.json`. Locally: `GITHUB_TOKEN="$("/c/Program Files/GitHub CLI/gh.exe" auth token)" npm run ingest`.
  Output is deterministic, so an unchanged upstream gives no diff. `refresh-data.yml` runs it weekly and commits.
- `gh` isn't on the Bash PATH. Use `"/c/Program Files/GitHub CLI/gh.exe"`.

## Layout

- `data/`: all content as YAML. `capabilities.yaml` (taxonomy, file order = display order), `products/<id>.yaml`,
  `projects/<id>.yaml`, `events.yaml` (timeline milestones, file order breaks date ties),
  `node-support/<product-id>.yaml` (renderer-level MaterialX node coverage, see the research guide).
- `src/data/node-support.ts`: resolves node-support records against `materialx-nodes.json` (most specific selector
  wins, exceptions override their record). Shared by the validator and `loadData()` (`nodeSupport`, `nodeColumns`).
- `src/data/schema.ts`: Zod schemas shared by Astro collections and the validator. Change the schema there only.
- `src/data/yaml.ts`: YAML parsing with the same options as Astro's loader. Use it for any script reading `data/`.
- `src/content.config.ts`: collections. `src/lib/data.ts` → `loadData()` for pages and endpoints.
- `src/lib/url.ts`: `withBase()`. Every internal link and asset URL must go through it (Pages base path).
- `src/styles/global.css`: design tokens (light + dark via `prefers-color-scheme` and `[data-theme]`), plus shared
  `.lv-<level>` colour hooks and `.chip` filter styles. The chart tokens (`--lag-*`, `--cov-*`, `--cmp-*`) were
  checked with the `dataviz` skill's `validate_palette.js` against `--surface` in each mode. Re-run it if you change
  them.
- `src/lib/view.ts`: labels, orderings and island prop types shared by the views.
- `src/lib/lag.ts`: version-lag maths for `/versions/`, served as `/data/version-lag.json`.
- Views: `/` (home), `/matrix/` (`SupportMatrix.svelte`), `/compare/` (`CompareView.svelte`), `/route/`
  (`RoutePlanner.svelte`), `/versions/` (`VersionLag.svelte`), `/nodes/` (`NodeTable.svelte`), `/timeline/`
  (`Timeline.svelte`), `/ecosystem/`, `/schemas/` (`SchemaExplorer.svelte`), `/products/<id>/`, `/review/`, `404`.
  Plus `SearchPalette.svelte` (Ctrl+K) in the header and `sitemap.xml`. Data downloads: `/data.json` and
  `/data/<name>.json`.
- `src/lib/matrix.ts`: `buildMatrix()`, the product × capability grid shared by `/matrix/` and `/data/support.json`
  (which `/compare/` and `/route/` fetch).
- Keep island props small. Long text or large datasets go in a `/data/*.json` endpoint and are fetched on demand:
  the matrix fetches `/data/matrix-details.json` when a cell is first opened, `/versions/` fetches
  `/data/version-lag.json`, `/nodes/` fetches `/data/materialx-nodes.json`, and the search fetches
  `/data/search-index.json` on first open.
- URL state: interactive views keep their filters in the query string via `src/lib/url-state.ts`. Read in `onMount`
  (never at init, or hydration mismatches), then write from an `$effect` with defaults omitted. New filters should
  follow suit, so every view stays shareable.
- Corrections: `src/lib/feedback.ts` builds pre-filled links to the issue forms in `.github/ISSUE_TEMPLATE/`. Field
  ids in `correction.yml` are the query parameters, so keep them in sync.

## UI conventions

- Level colours come from `.lv-<level>` (sets `--lv`). Fills must use `background: var(--lv-pattern, none), var(--lv)`
  so planned, deprecated and none also get a texture. The seven-level palette fails the dataviz validator on colour
  alone (deprecated↔none, planned reads grey), so the texture is the required secondary encoding. Text badges stay
  solid.
- `<dialog>` `close` events don't fire in every environment (the app's browser pane, for one). Clear the
  open/selected state in your own close handlers and in `oncancel`; don't rely on `onclose`.
- Islands that must react immediately (search shortcut) use `client:load`. `client:idle` never hydrates in background
  or hidden tabs.
- Grids of many controls use a roving tabindex (see `SupportMatrix.svelte`): one tab stop, arrow keys inside.
- Social card: `public/og.png` comes from `npm run og-image` (`scripts/make-og-image.ts`, sharp). Re-run it after big
  data changes. Its artwork is the real matrix.

## Data rules (do not relax)

- Every support record, release and event needs ≥1 source with `accessed` date, plus `confidence` and `verified`.
- No claims from memory: research against live official sources, preferring docs and release notes over forums.
- Uncertain or conflicting records get `review: "<why>"`. The user reviews only flagged and low-confidence records.
- Absence of a record = unknown. Never add a record just to say "unknown".
- Version strings are quoted. Product ids are kebab-case and match the file name.
- Scope includes adjacent industries: AEC, product design/CAD, automotive, simulation, XR/web.

## Researching products

- Follow `docs/research-guide.md` (levels, sources, review flags). Tier 1 (19 products) and Tier 2 (16 products) were
  researched by parallel agents grouped by vendor, then each file was independently fact-checked against every cited
  source. Use that two-step pattern (research, then verify) for any new batch.
- Discontinued products whose vendor site is gone (e.g. Clarisse): cite official docs through Wayback Machine
  snapshot URLs (`https://web.archive.org/web/<timestamp>/<original>`, `kind: docs`). Find pages with the CDX API:
  `https://web.archive.org/cdx/search/cdx?url=<site>/*&fl=original&collapse=urlkey`. archive.org rate-limits (429),
  so fetch sequentially.
- Verification agents work fine on Sonnet. Running six research agents on Opus at once hit the user's 5-hour usage
  limit, so stagger agents or use smaller groups.
- `npm run check:links` checks every source URL (0 broken at last run). It also runs warn-only at the end of the
  weekly refresh, which annotates dead links in the run summary. Sites that block bots: unrealengine.com,
  issues.unrealengine.com, autodesk.com product pages, support.maxon.net, projects.blender.org pages (its API and
  raw files work). Appending `.md` gives clean text on help.maxon.net, documentation.chaos.com and
  rmanwiki-27.pixar.com.

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
