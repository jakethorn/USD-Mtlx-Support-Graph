# Research guide: product support records

How to research a product's OpenUSD and MaterialX support and record it in `data/products/<id>.yaml`.
The schema is in [`src/data/schema.ts`](../src/data/schema.ts), the capability ids are in
[`data/capabilities.yaml`](../data/capabilities.yaml), and [`data/products/blender.yaml`](../data/products/blender.yaml)
is a worked example. `npm run validate` must pass when you're done.

## Principles

1. **Every claim comes from a live source you have read just now.** Never write a record from memory. If you can't
   find a source, don't write the record: a missing record means "unknown", which is fine.
2. **Prefer primary sources:** official docs, release notes and changelogs, the vendor's own GitHub repos and source
   code. Then vendor staff posts, conference talks and vendor blogs. Last, community reports.
3. **Be precise rather than generous.** "Supports USD" in marketing copy is not evidence for `usd.composition.variants`.
   Record what the docs actually say. Note gaps and limitations the docs mention.
4. **Paraphrase.** Notes and gaps are your own short sentences. Never paste long passages from sources.
5. **Flag doubt; don't hide it.** If sources conflict, are ambiguous, are old, or you had to interpret, add
   `review: "<why>"`. Records with `confidence: low` are flagged automatically. Only flagged records get human review.

## Support levels

Levels describe the **current shipping version** of the product.

| Level | Use when |
|---|---|
| `native` | Available out of the box in the shipping product, including first-party plugins **bundled with the installer** (set `via` to the plugin when it's a named component, e.g. maya-usd) |
| `plugin` | Requires a separately installed plugin or extension, first- or third-party. `via` names it |
| `partial` | Works, but the docs describe limits that rule out major parts of the capability (e.g. "imports static meshes only") |
| `experimental` | Shipped but labelled beta, experimental, preview or tech preview |
| `planned` | Publicly announced by the vendor, not shipped yet |
| `deprecated` | Still present but officially deprecated, or removed (set `until`) |
| `none` | A source **explicitly** says it is not supported. Never infer `none` from silence |

When support is `native` or `plugin` but with notable caveats, keep the level and list the caveats in `gaps`.

## Fields

- `since`: the product version in which the capability first shipped, only if a source says so (release notes are
  ideal). Leave it out otherwise.
- `via`: id of the plugin or provider. It must exist in `data/projects/` (open-source projects with a public repo) or
  in `data/products/`. If an open-source plugin isn't there yet, create `data/projects/<id>.yaml` following the
  project schema, checking existing files first so you don't duplicate one. Closed-source components (e.g. a
  vendor's internal USD plugin or editor) don't get a project file: leave `via` out and name them in `notes`.
- `hosts`: for render delegates and plugins, the product ids it applies to, only when sourced. Use ids from the Tier 1
  list below. Mention other hosts in `notes`.
- `confidence`: `high` for official docs, release notes or source code; `medium` for vendor staff posts, talks or
  vendor blogs; `low` for community or indirect evidence.
- `verified`: today's date. `sources[].accessed`: the date you read the source.
- Versions are always **quoted strings**: `"20.5"`, `"2025.1"`, `"24.08"`.

## Releases

List the product's recent major releases (about the last 3 to 5) under `releases:`. For each, record the USD and
MaterialX versions it bundles or is built against (`usd: "24.08"`, `materialx: "1.39.1"`), **only when a source
states them**. Release notes, "library versions" tables and VFX Reference Platform pages are good sources. These
feed the "version lag" view, so they are valuable. The USD version must be a real OpenUSD release (see
`data/generated/releases.json`; e.g. `"24.08"`, `"25.05.01"`, `"26.11.0"`).

## Issues

Under `issues:`, record a handful (≤ 5) of **notable, publicly tracked** problems that affect real use: an open GitHub
issue in an official repo, or a documented known issue in release notes. Skip minor bugs. Link the issue itself and
tie it to a capability when one fits.

## What to cover

Work through the capability groups in `data/capabilities.yaml`. The most valuable are:

- **Interchange:** import, export, USDZ; MaterialX import and export
- **Workflow:** native stage, layer editing, plugins
- **Shading:** UsdPreviewSurface, MaterialX in USD, renderer-specific shaders; shading models (Standard Surface,
  OpenPBR, glTF PBR)
- **Rendering:** Hydra delegate, Hydra host, render settings
- **Composition and scene description:** record these where the docs are explicit (e.g. "variants are supported on
  import", "UsdSkel import is supported").

Aim for depth on what's documented rather than a record for every capability. A typical Tier 1 product ends up with
roughly 12 to 30 records.

## Tier 1 product ids

Use these ids for `hosts` and `via` references (all of them will exist):

`houdini` `karma` `renderman` `maya` `3ds-max` `arnold` `katana` `nuke` `substance-3d-painter`
`substance-3d-designer` `blender` `cycles` `cinema-4d` `redshift` `v-ray` `unreal-engine` `unity` `omniverse`
`apple-realitykit`

## Before you finish

- Run `npm run validate`. Fix every error in your files. Errors that only mention Tier 1 ids which other researchers
  are still writing are expected; ignore those.
- Re-read each record once and ask: "Does the cited source actually say this?"
