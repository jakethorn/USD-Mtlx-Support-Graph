# USD-Mtlx-Support-Graph

Interactive, data-driven visualisations of how well **OpenUSD** and **MaterialX** are supported across film, VFX,
animation, games and adjacent industries (AEC, product design, automotive, XR and the web). The site covers DCCs,
renderers, game engines and the open-source tools around them.

**Live site:** https://jakethorn.github.io/USD-Mtlx-Support-Graph/ (once Pages is enabled)

> Early preview: the data model and site skeleton are in place, and data collection is under way.

## How the data works

All data lives in [`data/`](data) as YAML and is validated against [`src/data/schema.ts`](src/data/schema.ts).

| Path | What |
|---|---|
| `data/capabilities.yaml` | The capability taxonomy: the columns of the support matrix (e.g. `usd.composition.variants`, `mtlx.openpbr`) |
| `data/products/<id>.yaml` | One file per product: metadata, releases (with bundled USD/MaterialX versions), support records and known issues |
| `data/projects/<id>.yaml` | Open-source ecosystem projects: libraries, plugins, render delegates, converters, learning resources |
| `data/events.yaml` | Timeline events *(coming)* |
| `data/generated/*.json` | **Machine-generated, never edit by hand.** Written by `scripts/ingest/` and refreshed weekly |

The generated datasets are read straight from upstream:

- **`materialx-nodes.json`**: every node in MaterialX's standard libraries since 1.38.0, with inputs, outputs and the
  release it appeared in. For each of MaterialX's own code generators (GLSL, ESSL, Metal, OSL, MDL, Slang) it records
  whether a node has a native implementation, works via a node graph, or is unsupported.
- **`usd-schemas.json`**: every OpenUSD schema (prim types and API schemas) and property since 0.7.0, with the
  release each first appeared in.
- **`releases.json`**: OpenUSD and MaterialX release history.
- **`github-stats.json`**: stars, activity, licences and latest releases for every repo in `data/projects` and
  `data/products`.

All of them are also served from the site as `/data/<name>.json`.

The rules:

- **Support is per capability.** There is no single "supports USD" flag. Each record gives a level (`native`, `plugin`,
  `partial`, `experimental`, `planned`, `deprecated` or `none`) for one capability of one product.
- **Every claim has a source,** with the date it was checked. A missing record means *unknown*.
- **Uncertain records are flagged** with a `review:` note. `npm run review` lists them, along with every
  low-confidence record.
- **Quote version numbers** (`"24.10"`). Unquoted, YAML reads `24.10` as the number 24.1.

## Development

Requires Node 22.23 or newer. The ingestion scripts need Python 3.11 or newer (standard library only) and git.

```bash
npm install
npm run dev        # http://localhost:4321/USD-Mtlx-Support-Graph/
npm run validate   # schema, cross-reference and hygiene checks for /data
npm run review     # same, plus the list of records needing human review
npm run check      # type check
npm run build      # static site → dist/
npm run ingest     # refresh data/generated/ from upstream (set GITHUB_TOKEN for the GitHub API)
```

Ingestion keeps blobless, sparse clones of OpenUSD and MaterialX in `.cache/repos/`, so scanning every release takes
well under a minute.

Built with [Astro](https://astro.build) and [Svelte](https://svelte.dev). Pushes to `main` are validated, built and
deployed to GitHub Pages by [`.github/workflows/site.yml`](.github/workflows/site.yml).
[`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml) re-runs ingestion every Monday, then
commits and deploys any changes.

## Contributing

Spotted something wrong or missing? [Open an issue](https://github.com/jakethorn/USD-Mtlx-Support-Graph/issues) with a
link to a source, or edit the product's YAML file and open a pull request. CI validates every change.
