import type { APIRoute } from 'astro';
import { loadData } from '../../lib/data';
import { releases } from '../../data/generated';
import { lagReleases, upstreamTicks, type VersionLagData } from '../../lib/lag';
import { withBase } from '../../lib/url';

/**
 * Derived dataset for /versions/: every product release that states a bundled OpenUSD or MaterialX version,
 * with its lag behind upstream. Fetched client-side so the page doesn't carry it as island props.
 */
export const GET: APIRoute = async () => {
  const { products } = await loadData();
  const upstream = upstreamTicks(releases);
  const body: VersionLagData = {
    note: 'Derived from data/products/*.yaml and data/generated/releases.json. months = product release date minus upstream tag date; behind = newer upstream releases already tagged at ship (OpenUSD: YY.MM releases only).',
    upstream,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      vendor: p.vendor,
      href: withBase(`products/${p.id}/`),
      categories: p.categories,
      releases: {
        usd: lagReleases('usd', p.releases, upstream.usd),
        materialx: lagReleases('materialx', p.releases, upstream.materialx),
      },
    })),
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
