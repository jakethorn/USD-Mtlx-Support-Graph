/** Product × capability grid data, shared by the matrix page, the compare view and /data/support.json. */
import type { Capability } from '../data/schema';
import type { ProductEntry, ProjectEntry } from './data';
import { withBase } from './url';
import { capAnchor, type MatrixCap, type MatrixRow } from './view';

export interface LatestBundled {
  /** Product release that bundles it. */
  release: string;
  version: string;
}

export interface SupportRow extends MatrixRow {
  /** Newest release (file order is newest first) that states a bundled version. */
  latest: { usd?: LatestBundled; materialx?: LatestBundled };
}

export function buildMatrix(products: ProductEntry[], projects: ProjectEntry[], capabilities: Capability[]) {
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? projects.find((p) => p.id === id)?.name ?? id;

  const rows: SupportRow[] = products
    .filter((p) => p.support.length > 0)
    .map((p) => {
      const usd = p.releases.find((r) => r.usd);
      const mtlx = p.releases.find((r) => r.materialx);
      return {
        id: p.id,
        name: p.name,
        vendor: p.vendor,
        href: withBase(`products/${p.id}/`),
        categories: p.categories,
        industries: p.industries,
        tier: p.tier,
        discontinued: p.status === 'discontinued',
        cells: Object.fromEntries(
          p.support.map((s) => [
            s.capability,
            {
              level: s.level,
              since: s.since,
              via: s.via ? nameOf(s.via) : undefined,
              confidence: s.confidence,
              flagged: Boolean(s.review) || s.confidence === 'low',
            },
          ]),
        ),
        latest: {
          ...(usd ? { usd: { release: usd.version, version: usd.usd! } } : {}),
          ...(mtlx ? { materialx: { release: mtlx.version, version: mtlx.materialx! } } : {}),
        },
      };
    });

  const caps: MatrixCap[] = capabilities.map((c) => ({ ...c, anchor: capAnchor(c.id) }));
  return { rows, caps };
}

/** The matrix island only needs the grid itself. */
export const toMatrixRow = ({ latest: _latest, ...row }: SupportRow): MatrixRow => row;
